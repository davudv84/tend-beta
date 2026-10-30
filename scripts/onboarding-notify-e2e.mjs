// The setup guide and notifications, end to end over HTTP against a real production build (npm run e2e:onboarding).
//
// Real: the Next server, its database, sign-up and sign-in, the agent's key and the gateway, the Web Push encryption and VAPID signature, the
// request wrapper that delivers after the response. Stand-in: the push service. Browsers' push services cannot be reached from a test, so a
// local HTTP server takes their place (TEND_PUSH_TEST_ENDPOINTS=loopback, refused on Vercel) and decrypts each message with the browser's private
// key, exactly as a browser would. What it proves: what reaches a browser, once, and what never does. It does not prove a real browser shows it.
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "./isolated-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dir = mkdtempSync(path.join(tmpdir(), "tend-onboarding-e2e-"));
let URL_ = "";
let passed = 0, failed = 0;
const check = (ok, text) => { if (ok) passed++; else failed++; console.log(`${ok ? "ok  " : "FAIL"} ${text}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, { body, cookie, key, headers = {} } = {}) {
  const res = await fetch(URL_ + p, { method, redirect: "manual", headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }), ...(key && { authorization: `Bearer ${key}` }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body: data, location: res.headers.get("location"), setCookie: res.headers.get("set-cookie") };
}
const PW = "correct horse battery staple";
const mailTo = async (email) => {
  for (const end = Date.now() + 3000; ; await sleep(100)) {
    let files = [];
    try { files = readdirSync(path.join(dir, "outbox")).filter((f) => f.includes(email)).sort(); } catch {}
    if (files.length || Date.now() > end) return files.length ? readFileSync(path.join(dir, "outbox", files.at(-1)), "utf8") : "";
  }
};
async function account(email) {
  await call("POST", "/api/account/register", { body: { email, password: PW } });
  const token = /#token=([A-Za-z0-9_-]{43})/.exec(await mailTo(email))?.[1];
  await call("POST", "/api/account/verify", { body: { token } });
  const r = await call("POST", "/api/account/sign-in", { body: { email, password: PW } });
  return r.setCookie?.split(";")[0];
}

// ---- the stand-in push service: decrypts what it receives (RFC 8291), as a browser would --------------------------------------------
const browser = createECDH("prime256v1");
browser.generateKeys();
const auth = randomBytes(16);
const received = [];
function decrypt(body) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), record = body.subarray(21 + idlen);
  const ua = browser.getPublicKey();
  const ikm = Buffer.from(hkdfSync("sha256", browser.computeSecret(asPublic), auth, Buffer.concat([Buffer.from("WebPush: info\0"), ua, asPublic]), 32));
  const key = (info, n) => Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from(info), n));
  const d = createDecipheriv("aes-128-gcm", key("Content-Encoding: aes128gcm\0", 16), key("Content-Encoding: nonce\0", 12));
  d.setAuthTag(record.subarray(-16));
  const plain = Buffer.concat([d.update(record.subarray(0, -16)), d.final()]);
  return JSON.parse(plain.subarray(0, -1).toString());
}
const pushService = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    try { received.push({ auth: req.headers.authorization, payload: decrypt(Buffer.concat(chunks)) }); res.statusCode = 201; } catch { res.statusCode = 400; }
    res.end();
  });
});
const waitFor = async (n, ms = 5000) => { for (const end = Date.now() + ms; received.length < n && Date.now() < end; ) await sleep(100); return received.length >= n; };

async function main() {
  await new Promise((r) => pushService.listen(0, "127.0.0.1", r));
  const endpoint = `http://127.0.0.1:${pushService.address().port}/push/browser-1`;
  const vapid = createECDH("prime256v1");
  vapid.generateKeys();
  const server = await startIsolatedServer({ root, env: {
    TEND_ADMIN_TOKEN: `e2e_admin_${randomBytes(20).toString("hex")}`, TEND_ADMIN: "0", TEND_DATA_DIR: dir, TEND_PUSH_TEST_ENDPOINTS: "loopback",
    TEND_VAPID_PUBLIC_KEY: vapid.getPublicKey().toString("base64url"), TEND_VAPID_PRIVATE_KEY: vapid.getPrivateKey().toString("base64url"), TEND_VAPID_SUBJECT: "mailto:e2e@example.com",
  } });
  URL_ = server.url;
  try {
    console.log("-- a new account starts in the setup guide");
    const ana = await account("ana@example.com"), ben = await account("ben@example.com");
    const home = await call("GET", "/home", { cookie: ana });
    check(home.status === 307 && home.location?.endsWith("/welcome"), `Home sends a new account to /welcome (${home.status} ${home.location})`);
    check((await call("GET", "/welcome", { cookie: ana })).status === 200, "the guide renders");
    check((await call("GET", "/api/v1/onboarding")).status === 403, "signed out, the guide's API answers 403");

    console.log("\n-- connect, verify, rule");
    const reg = await call("POST", "/api/v1/agents", { cookie: ana, body: { name: "Probe", model: "Claude Code", provider: "Custom" } });
    const agentId = reg.body.agent.id, key = reg.body.apiKey;
    let g = await call("POST", "/api/v1/onboarding", { cookie: ana, body: { action: "progress", step: "connect", integration: "claudeCode", agentId } });
    check(g.status === 200 && g.body.agent?.id === agentId && g.body.checks.connectedAt === null, "progress is stored; not connected before the agent calls");
    check(!JSON.stringify(g.body).includes("tend_sk_"), "the guide's answers never contain a key");
    check((await call("GET", "/home", { cookie: ana })).status === 307, "a returning account resumes the guide");
    await call("GET", "/api/v1/agent/inbox", { key });
    g = await call("GET", "/api/v1/onboarding", { cookie: ana });
    check(typeof g.body.checks.connectedAt === "number", "connected only after the agent's own authenticated call");
    const pol = await call("GET", `/api/v1/agents/${agentId}/policy`, { cookie: ana });
    await call("POST", `/api/v1/agents/${agentId}/policy`, { cookie: ana, body: { rules: [{ tool: "test_ping", action: "ping", effect: "approve" }], enforcement: "enforce", expectedVersion: pol.body.version } });
    g = await call("GET", "/api/v1/onboarding", { cookie: ana });
    check(g.body.checks.policy === "approve", "the rule is read back from the saved policy");

    console.log("\n-- browser notifications reach the subscribed browser, once, with nothing from the event in them");
    const p256dh = browser.getPublicKey().toString("base64url");
    const sub = await call("POST", "/api/v1/notifications/subscriptions", { cookie: ana, body: { endpoint, keys: { p256dh, auth: auth.toString("base64url") }, locale: "en" } });
    check(sub.status === 201, `Ana's browser subscribes (${sub.status})`);
    const foreign = await call("POST", "/api/v1/notifications/subscriptions", { cookie: ana, body: { endpoint: "https://10.0.0.1/push", keys: { p256dh, auth: auth.toString("base64url") } } });
    check(foreign.status === 422, "an endpoint that is not a push service is refused");
    const asked = await call("POST", "/api/v1/gateway/requests", { key, body: { tool: "test_ping", params: { message: "hello from e2e" } }, headers: { "idempotency-key": "e2e-1" } });
    check(asked.status === 201 && asked.body.status === "pending", "the test action waits for approval");
    check(await waitFor(1), "a browser notification arrived after the response");
    const msg = received[0]?.payload ?? {};
    check(msg.title === "TEND: approval needed" && msg.url === `/oversight?request=${asked.body.id}`, `fixed text and a deep link (${JSON.stringify(msg)})`);
    check(!/Probe|test_ping|hello/.test(JSON.stringify(msg)), "no agent name, tool or argument in what the browser receives");
    check(/^vapid t=.+, k=/.test(received[0]?.auth ?? ""), "signed with the server's VAPID key");
    await call("POST", "/api/v1/gateway/requests", { key, body: { tool: "test_ping", params: { message: "hello from e2e" } }, headers: { "idempotency-key": "e2e-1" } });
    await sleep(800);
    check(received.length === 1, "the same request again (same idempotency key) sends nothing new");

    console.log("\n-- the other workspace sees and changes nothing");
    const benList = await call("GET", "/api/v1/notifications", { cookie: ben });
    check(benList.body.items.length === 0 && benList.body.unread === 0, "Ben has no notifications");
    check((await call("POST", `/api/v1/reviews/${asked.body.id}`, { cookie: ben, body: { status: "approved" } })).status === 404, "Ben cannot answer Ana's request");
    check((await call("POST", "/api/v1/notifications/read", { cookie: ben, body: { all: true } })).body.updated === 0, "Ben's 'mark all read' touches nothing of Ana's");
    check((await call("POST", "/api/v1/onboarding", { cookie: ben, body: { action: "progress", step: "verify", agentId } })).status === 404, "Ben cannot point his guide at Ana's agent");
    check((await call("DELETE", "/api/v1/notifications/subscriptions", { cookie: ben, body: { endpoint } })).body.removed === 0, "Ben cannot turn off Ana's browser");
    check((await call("POST", "/api/v1/notifications/read", { cookie: ana, body: { all: true }, headers: { origin: "https://evil.example" } })).status === 403, "a cross-site request is refused");

    console.log("\n-- Ana answers in the app; the agent runs the action through the gateway; the guide completes");
    check((await call("POST", "/api/v1/onboarding", { cookie: ana, body: { action: "complete" } })).status === 409, "completing before the test ran is refused");
    const list = await call("GET", "/api/v1/notifications", { cookie: ana });
    check(list.body.unread === 1 && list.body.items[0].kind === "approval" && list.body.items[0].href === msg.url, "the same approval is listed in the app");
    check((await call("POST", `/api/v1/reviews/${asked.body.id}`, { cookie: ana, body: { status: "approved" } })).status === 200, "Ana approves through the normal review route");
    const token = (await call("POST", `/api/v1/authorizations/${asked.body.id}/token`, { key, body: {} })).body.token;
    const ran = await call("POST", "/api/v1/gateway/execute", { key, body: { authorizationId: asked.body.id, token, tool: "test_ping", params: { message: "hello from e2e" } } });
    check(ran.status === 200 && ran.body.executed === true, "the gateway ran it");
    const after = await call("GET", "/api/v1/notifications", { cookie: ana });
    check(after.body.unread === 0 && after.body.items[0].resolved, "answered: the notification is read and resolved");
    g = await call("GET", "/api/v1/onboarding", { cookie: ana });
    check(g.body.checks.test?.outcome === "ran", "the guide sees the gateway's own record of the run");
    check((await call("POST", "/api/v1/onboarding", { cookie: ana, body: { action: "complete" } })).status === 200, "and completes");
    check((await call("GET", "/home", { cookie: ana })).status === 200, "Home no longer redirects");

    console.log("\n-- repeated blocks are one notification and one browser message; preferences and unsubscribing are honoured");
    for (let i = 0; i < 3; i++) await call("POST", "/api/v1/gateway/requests", { key, body: { tool: "write_note", params: { name: "n", text: "t" } } });
    await waitFor(2);
    await sleep(500);
    const blocked = (await call("GET", "/api/v1/notifications", { cookie: ana })).body.items.filter((i) => i.kind === "blocked");
    check(blocked.length === 1 && blocked[0].count === 3, `three blocks, one notification counting 3 (${blocked.map((b) => b.count)})`);
    check(received.length === 2 && received[1].payload.title === "TEND: action blocked", `one browser message for them (${received.length - 1})`);
    await call("POST", "/api/v1/notifications/preferences", { cookie: ana, body: { approval: false } });
    await call("POST", "/api/v1/gateway/requests", { key, body: { tool: "test_ping", params: { message: "muted" } }, headers: { "idempotency-key": "e2e-2" } });
    await sleep(1200);
    check(received.length === 2, "approvals turned off for the browser: none sent, still listed in the app");
    const test1 = await call("POST", "/api/v1/notifications/test", { cookie: ana });
    check(test1.body.push?.sent === 1 && received.at(-1)?.payload.title === "TEND: test notification", "Send test notification reaches the browser");
    await call("DELETE", "/api/v1/notifications/subscriptions", { cookie: ana, body: { endpoint } });
    const test2 = await call("POST", "/api/v1/notifications/test", { cookie: ana });
    check(test2.body.push?.sent === 0 && received.length === 3, "after turning it off, nothing reaches that browser");

    console.log("\n-- skipping and restarting");
    check((await call("GET", "/home", { cookie: ben })).status === 307, "Ben starts in the guide");
    await call("POST", "/api/v1/onboarding", { cookie: ben, body: { action: "skip" } });
    check((await call("GET", "/home", { cookie: ben })).status === 200, "after skipping, Home stays Home");
    await call("POST", "/api/v1/onboarding", { cookie: ben, body: { action: "restart" } });
    check((await call("GET", "/home", { cookie: ben })).status === 307, "a restart from Settings brings the guide back");
  } finally {
    await server.stop();
    pushService.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
