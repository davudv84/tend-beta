// What a new agent runs to prove the whole path through Tend: it connects, asks to run a harmless test action, waits for
// a person, spends the single-use token and lets Tend run the action. It uses only the endpoints every agent uses
// (inbox, gateway/requests, authorizations/{id}/token, gateway/execute). Nothing here is a second mechanism.
// It prints no key and no token, and it stops on the first answer that is not exactly what it expects.

export const TEST_SCRIPT = `const url = process.env.TEND_URL, key = process.env.TEND_AGENT_KEY;
if (!url || !key) { console.error("Set TEND_URL and TEND_AGENT_KEY."); process.exit(1); }
const pollMs = Number(process.env.TEND_POLL_MS) || 2000;
const tend = async (path, body, headers = {}) => {
  const res = await fetch(url + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: \`Bearer \${key}\`, ...(body && { "Content-Type": "application/json" }), ...(process.env.TEND_PROTECTION_BYPASS && { "x-vercel-protection-bypass": process.env.TEND_PROTECTION_BYPASS }), ...(process.env.TEND_CF_ACCESS_CLIENT_ID && process.env.TEND_CF_ACCESS_CLIENT_SECRET && { "CF-Access-Client-Id": process.env.TEND_CF_ACCESS_CLIENT_ID, "CF-Access-Client-Secret": process.env.TEND_CF_ACCESS_CLIENT_SECRET }), ...headers },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const fail = (code, text) => { console.error(text); process.exit(code); };

// 1. Connect. Tend notices an authenticated call from this key; that is the proof the agent is really talking to it.
const hello = await tend("/api/v1/agent/inbox").catch(() => ({ status: 0, body: {} }));
if (hello.status !== 200) fail(1, \`Could not connect to Tend (\${hello.status || "no answer"} \${hello.body.error ?? ""}).\`);
console.log(\`Connected to Tend as "\${hello.body.agentId}".\`);

// 2. Ask to run the test action. Tend decides from the permissions you chose.
const params = { message: "hello from my agent" };
const asked = await tend("/api/v1/gateway/requests", { tool: "test_ping", params }, { "Idempotency-Key": \`test-\${Date.now()}\` });
if (asked.status === 403) fail(2, \`Tend blocked the test action (\${asked.body.reason}). In the dashboard, set "Send a test ping" to "Ask me first", then run this again.\`);
if (![200, 201].includes(asked.status) || typeof asked.body.id !== "string") fail(2, \`Tend did not accept the request (\${asked.status} \${asked.body.error ?? ""}).\`);
const id = asked.body.id;
console.log(asked.body.status === "pending" ? "Waiting for you to approve it in the Tend dashboard..." : "Your permissions allow it without asking.");

// 3. Wait for the decision, then take the single-use token. Anything but "still waiting" or a token is final.
let token;
for (const deadline = Date.now() + 5 * 60 * 1000; !token && Date.now() < deadline; ) {
  const claim = await tend(\`/api/v1/authorizations/\${id}/token\`, {});
  if (claim.status === 200 && claim.body.token) token = claim.body.token;
  else if (claim.status === 202) await new Promise((r) => setTimeout(r, pollMs));
  else fail(3, \`Not approved (\${claim.body.status ?? claim.body.error ?? claim.status}). Nothing was run.\`);
}
if (!token) fail(4, "Nobody decided in time. Nothing was run.");

// 4. Spend the token. Tend runs the action itself and answers only with what it allows.
const ran = await tend("/api/v1/gateway/execute", { authorizationId: id, token, tool: "test_ping", params });
if (ran.status !== 200 || ran.body.executed !== true) fail(5, \`Tend did not confirm the action (\${ran.status} \${ran.body.error ?? ""}). Treat it as not done.\`);
console.log(\`Tend ran the action and answered: \${ran.body.result?.reply}\`);
console.log("Done. Look at the Tend dashboard for the verified result.");`;

const URL_OK = /^https?:\/\/[A-Za-z0-9.:[\]-]+$/;
const KEY_OK = /^tend_sk_[A-Za-z0-9_-]{24,64}$/;

/** One paste into a terminal: sets the two variables for this command only and runs the script. Needs Node 18 or newer. */
export function connectCommand(url: string, key: string) {
  if (!URL_OK.test(url)) throw new Error("not a plain http(s) address");
  if (!KEY_OK.test(key)) throw new Error("not a Tend agent key");
  return `TEND_URL=${url} TEND_AGENT_KEY=${key} node --input-type=module <<'TEND_TEST'\n${TEST_SCRIPT}\nTEND_TEST`;
}

/** The same command with the key hidden, for showing on screen. */
export const maskedCommand = (url: string) => connectCommand(url, `tend_sk_${"x".repeat(24)}`).replace(/tend_sk_x{24}/, "tend_sk_••••••••");
