// What a new agent runs to prove the whole path through Tend: it connects, asks to run a harmless test action, waits for
// a person, spends the single-use token and lets Tend run the action. It uses only the endpoints every agent uses
// (inbox, gateway/requests, authorizations/{id}/token, gateway/execute). Nothing here is a second mechanism.
// It prints no key and no token, and it stops on the first answer that is not exactly what it expects.
import type { ConnectKind } from "./integrations-catalog";

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

/**
 * The setup guide's commands. The key appears in exactly one of them, the export line copied once when the key is shown; the other two read
 * it from the terminal's environment, so they can be shown, copied and re-run without the key ever being on screen again.
 */
export function envCommand(url: string, key: string) {
  if (!URL_OK.test(url)) throw new Error("not a plain http(s) address");
  if (!KEY_OK.test(key)) throw new Error("not a Tend agent key");
  return `export TEND_URL=${url}\nexport TEND_AGENT_KEY=${key}`;
}
export const maskedEnv = (url: string) => envCommand(url, `tend_sk_${"x".repeat(24)}`).replace(/tend_sk_x{24}/, "tend_sk_••••••••");
/** One authenticated call and nothing else: how the guide checks that the agent's key reaches this server. */
export const VERIFY_COMMAND = `curl -sS -H "Authorization: Bearer $TEND_AGENT_KEY" "$TEND_URL/api/v1/agent/inbox"`;
export const TEST_COMMAND = `node --input-type=module <<'TEND_TEST'\n${TEST_SCRIPT}\nTEND_TEST`;

/** The same command with the key hidden, for showing on screen. */
export const maskedCommand = (url: string) => connectCommand(url, `tend_sk_${"x".repeat(24)}`).replace(/tend_sk_x{24}/, "tend_sk_••••••••");

/**
 * How to wire a real agent, per kind of connection. The key is never embedded: the agent reads it from TEND_AGENT_KEY, which the person sets
 * where the agent runs. These are instructions to copy, not a claim that the agent is connected; only a real tool call shows that.
 */
export function agentSnippet(kind: ConnectKind, url: string) {
  if (!URL_OK.test(url)) throw new Error("not a plain http(s) address");
  const env = `export TEND_URL=${url}\nexport TEND_AGENT_KEY=tend_sk_…   # the key above, where your agent runs`;
  // Every adapter comes from this TEND server (scripts/build-sdk.mjs builds /sdk/), so no access to TEND's repository is needed.
  const get = `curl -fsSO ${url}/sdk/tend.mjs     # TEND's adapters: one file, no dependencies, Node 18+`;
  const rule = "// In TEND (Policies, or the Permissions step) give the tool a rule: send_email · call → Allow, Ask me first or Never.";
  if (kind === "claude") return `${env}\n${get}\n\n// Anthropic SDK: wrap each sensitive tool's function; call the wrapped one when Claude asks for the tool.
import { connectTend, guardTool } from "./tend.mjs";
const gate = connectTend();
const sendEmail = guardTool(gate, "send_email", ({ to }) => realSend(to));   // your real code runs only on TEND's yes
// in your tool loop:  const result = await sendEmail(toolUse.input);       // otherwise a "Not done: ..." sentence for Claude
${rule}`;
  if (kind === "openai") return `${env}\n${get}\n\n// OpenAI Agents SDK: the tool's execute function goes through TEND.
import { tool } from "@openai/agents";
import { connectTend, guardTool } from "./tend.mjs";
const gate = connectTend();
export const sendEmail = tool({
  name: "send_email", description: "Send an email", parameters: { type: "object", properties: { to: { type: "string" } }, required: ["to"], additionalProperties: false },
  execute: guardTool(gate, "send_email", ({ to }) => realSend(to)),
});
${rule}`;
  if (kind === "chat") return `${env}\n${get}\n\n// Any provider with the OpenAI-compatible Chat Completions API: OpenAI, Gemini, Mistral, Groq, Ollama, or your own server.
import { connectTend, guardTool, runChatAgent } from "./tend.mjs";
const gate = connectTend();
const tools = [{ name: "send_email", description: "Send an email", params: { to: "Recipient" }, run: guardTool(gate, "send_email", ({ to }) => realSend(to)) }];
await runChatAgent({ provider: "groq", model: "llama-3.3-70b-versatile", tools, prompt: "Email the team" }); // or baseURL + apiKey for your own server
${rule}`;
  if (kind === "js") return `${env}\n${get}\n\n// LangChain, LangGraph, Mastra or any JavaScript framework: wrap the tool's function, then define the tool as usual.
import { tool } from "langchain";              // or @langchain/core/tools, or createTool from @mastra/core/tools
import { connectTend, guardTool } from "./tend.mjs";
const gate = connectTend();
export const sendEmail = tool(guardTool(gate, "send_email", ({ to }) => realSend(to)), { name: "send_email", description: "Send an email", schema });
${rule}`;
  if (kind === "python") return `${env}\ncurl -fsSO ${url}/sdk/tend_gate.py   # TEND's Python client: one file, standard library only

# PydanticAI, AutoGen, CrewAI or any Python framework.
from tend_gate import Gate, guard_tool
gate = Gate()
_send = guard_tool(gate, "send_email", lambda to: real_send(to))
def send_email(to: str) -> str:
    """Send an email."""
    return _send(to=to)          # runs only on TEND's yes; otherwise returns "Not done: ..."
# Give send_email to your framework as a tool (Agent(tools=[send_email]), @tool, ...).
# In TEND give it a rule: send_email · call → Allow, Ask me first or Never.`;
  if (kind === "mcp") return `${get}\n\n// In your MCP host's configuration (Claude Code, Cursor, Cline, Hermes Agent, OpenClaw...), start TEND in front of the server:
{
  "mcpServers": {
    "files": {
      "command": "node",
      "args": ["/absolute/path/to/tend.mjs", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/folder"],
      "env": { "TEND_URL": "${url}", "TEND_AGENT_KEY": "tend_sk_…" }
    }
  }
}
// In TEND each MCP tool is its name with the action "call", e.g. read_file · call.`;
  return `${env}\n\n# 1. Ask before acting (the exact request is what a person approves)
curl -s -H "authorization: Bearer $TEND_AGENT_KEY" -H 'content-type: application/json' \\
  -d '{"tool":"send_email","action":"send","resource":"client-1042","detail":"Email to client 1042"}' $TEND_URL/api/v1/authorizations
# 2. Once allowed: a one-time token        POST $TEND_URL/api/v1/authorizations/<id>/token
# 3. Spend it, repeating the request, then act only on {"authorized":true}
#                                           POST $TEND_URL/api/v1/authorizations/<id>/consume
# Every call, runnable: docs/api-examples.md`;
}
