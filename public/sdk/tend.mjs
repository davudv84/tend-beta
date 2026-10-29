// TEND for JavaScript agents, one file, no dependencies (Node 18+). Built from TEND's own examples by scripts/build-sdk.mjs.
//   import { connectTend, guardTool } from "./tend.mjs";
//   const gate = connectTend();                       // TEND_URL and TEND_AGENT_KEY from the environment
//   const sendEmail = guardTool(gate, "send_email", (args) => realSend(args));   // runs only on TEND's yes
// MCP proxy:  node tend.mjs -- <your MCP server command>   (the host starts this instead of the server)
// This is cooperative enforcement: code that skips the gate is not stopped.
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// ---- examples/claude-agent/gate.mjs ----------------------------------------------------------------------
// The trusted execution wrapper. A sensitive tool function runs only inside gate.run(), and only after Tend
// has authorized exactly this action. Default flow, one round trip when the policy allows it: authorize-and-spend → act;
// when a person must decide: ask → wait → spend → act. flow: "token" keeps the older authorize → claim token → consume → act.
//
//   const out = await gate.run({ tool: "send_payment", action: "execute", resource: "INV-1", detail: "EUR 5.00 to X" }, () => pay());
//   out.executed === true only if Tend said yes. Every other outcome means nothing was done; `out.detail`, when present, says why in words.
//
// Fail closed: a timeout, a network error, a 4xx/5xx, a malformed answer or an unexpected body all end in
// "do not act". Creating a request is retried (it is idempotent); consuming never is. Nothing here prints a
// token or a key, and errors carry only status and code. What reaches Tend about the call is identifiers only.
//
// What this does NOT do: stop code that skips the gate, or that holds the real credentials itself.
// This is cooperative enforcement. See docs/enforcement.md.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const transient = (e) => !e.status || e.status >= 500;
const same = (a, b) => (a ?? null) === (b ?? null);
/** Why a call to TEND failed, in words: a hint from the client, else TEND's own validation errors or message. */
const why = (e) => e.hint ?? (e.body?.errors?.join?.("; ") || e.body?.message || undefined);

export function createGate({ tend, approvalTimeoutMs = 120_000, pollMs = 2_000, retries = 2, retryMs = 500, onPending, log = () => {}, flow = "fast" }) {
  /**
   * @param request { tool, action, resource?, detail? }  what is being authorized and, byte for byte, what will be done
   * @param execute  async ({ authorizationId }) => result. The protected action: called at most once, and only after a successful consume.
   * @param report   optional (event) => Promise: tells Tend's monitoring what happened. Failures to report never change the outcome.
   */
  async function run(request, execute, report = async () => {}) {
    const req = { tool: request.tool, action: request.action, ...(request.resource && { resource: request.resource }), ...(request.detail && { detail: request.detail }), ...(request.args && { args: request.args }) };
    let authorizationId;
    const label = `${req.tool}.${req.action}${req.resource ? ` ${req.resource}` : ""}`;

    const stop = async (outcome, reason, event = {}) => {
      log(`  gate ${label} → not executed (${outcome}${reason ? `: ${reason}` : ""})`);
      try {
        await report({ ...req, outcome: event.outcome ?? "cancelled", ...(authorizationId && { authorizationId }), ...(event.policy && { policy: event.policy }), error: reason ? `${outcome}: ${reason}` : outcome });
      } catch {
        // Monitoring is best effort; the action was not taken either way.
      }
      return { executed: false, outcome, ...(reason && { reason }), ...(authorizationId && { authorizationId }) };
    };

    const key = request.idempotencyKey ?? `gate-${randomUUID()}`;
    const echoes = (used) => used?.authorized === true && used.authorizationId === authorizationId && used.tool === req.tool && used.action === req.action && same(used.resource, req.resource) && same(used.detail, req.detail);
    const act = async () => {
      let outcome = "success", result, error;
      try {
        result = await execute({ authorizationId });
      } catch (e) {
        outcome = "failure";
        error = "execution_failed";
        log(`  gate ${label} → authorized, but the action failed (${e?.name ?? "Error"})`);
      }
      try {
        await report({ ...req, outcome, authorizationId, ...(error && { error }) });
      } catch {
        // The authorization record shows it was spent; the missing report is itself visible to operators.
      }
      return { executed: true, outcome, result, authorizationId };
    };

    if (flow === "fast") {
      // 1. Ask, and when the policy allows it, have it authorized and spent in the same call. Retried only with the same key: a repeat of a
      //    request that was already spent is refused by TEND (409), so a lost answer can never make the action run twice.
      let first;
      for (let attempt = 0; ; attempt++) {
        try {
          first = await tend("/api/v1/authorize", req, { "Idempotency-Key": key });
          break;
        } catch (e) {
          if (e.status === 403 && e.body?.status === "denied") {
            authorizationId = e.body.id;
            const policyDenied = ["policy_denied", "no_policy", "invalid_policy", "missing_permission"].includes(e.body.reason);
            return stop("denied", e.body.reason, { outcome: "denied", ...(policyDenied && { policy: e.body.reason }) });
          }
          if (transient(e) && attempt < retries) { await sleep(retryMs); continue; }
          return { ...(await stop(transient(e) ? "unavailable" : "refused", e.code)), ...(why(e) && { detail: why(e) }) };
        }
      }
      authorizationId = first?.id;
      if (typeof authorizationId !== "string") return stop("refused", "unexpected_response");
      if (first.status === "consumed") return echoes({ ...first, authorizationId: first.id }) ? act() : stop("refused", "unexpected_response");
      if (first.status !== "pending") return stop("refused", "unexpected_response");

      // 2. A person decides. Only TEND's answer counts.
      log(`  gate ${label} → waiting for human approval (${authorizationId})`);
      await onPending?.(authorizationId);
      const deadline = Date.now() + approvalTimeoutMs;
      for (;;) {
        let st;
        try {
          st = await tend(`/api/v1/authorizations/${authorizationId}`);
        } catch (e) {
          if (!transient(e)) return stop("refused", e.code ?? "unexpected_response");
        }
        if (st?.status === "approved") break;
        if (st && st.status !== "pending") return stop(st.status === "rejected" ? "rejected" : st.status === "expired" ? "expired" : "refused", st.status, { outcome: st.status === "rejected" ? "denied" : "cancelled" });
        if (Date.now() >= deadline) {
          try { await tend(`/api/v1/authorizations/${authorizationId}/cancel`, {}); } catch { /* TEND expires it on its own */ }
          return stop("timeout", "no_decision");
        }
        await sleep(pollMs);
      }
      // 3. Spend it, once, right before acting. Never retried: after an ambiguous failure, ask again.
      let used;
      try {
        used = await tend(`/api/v1/authorizations/${authorizationId}/spend`, req);
      } catch (e) {
        const status = e.body?.status;
        if (status === "rejected") return stop("rejected", status, { outcome: "denied" });
        return { ...(await stop(transient(e) ? "unavailable" : "refused", e.code)), ...(why(e) && { detail: why(e) }) };
      }
      return echoes(used) ? act() : stop("refused", "unexpected_response");
    }

    // 1. Ask. Retried with the same idempotency key, so a lost response never creates a second request.
    let created;
    for (let attempt = 0; ; attempt++) {
      try {
        created = await tend("/api/v1/authorizations", req, { "Idempotency-Key": key });
        break;
      } catch (e) {
        if (e.status === 403 && e.body?.status === "denied") {
          authorizationId = e.body.id;
          const policyDenied = ["policy_denied", "no_policy", "invalid_policy", "missing_permission"].includes(e.body.reason);
          return stop("denied", e.body.reason, { outcome: "denied", ...(policyDenied && { policy: e.body.reason }) });
        }
        if (transient(e) && attempt < retries) {
          await sleep(retryMs);
          continue;
        }
        return { ...(await stop(transient(e) ? "unavailable" : "refused", e.code)), ...(why(e) && { detail: why(e) }) };
      }
    }
    authorizationId = created?.id;
    if (typeof authorizationId !== "string" || !["pending", "approved"].includes(created.status)) return stop("refused", "unexpected_response");

    // 2. If a human has to decide, wait. Only Tend's own answer counts; nothing the agent or model says does.
    if (created.status === "pending") {
      log(`  gate ${label} → waiting for human approval (${authorizationId})`);
      await onPending?.(authorizationId);
    }
    const deadline = Date.now() + approvalTimeoutMs;
    let token;
    for (;;) {
      try {
        const claim = await tend(`/api/v1/authorizations/${authorizationId}/token`, {});
        if (claim.status === "approved" && typeof claim.token === "string") {
          token = claim.token;
          break;
        }
        if (claim.status !== "pending") return stop("refused", "unexpected_response");
      } catch (e) {
        if (!transient(e)) {
          // Rejected, expired, cancelled, or the agent is no longer allowed: final.
          const status = e.body?.status ?? e.body?.reason ?? e.code;
          return stop(status === "rejected" ? "rejected" : status === "expired" ? "expired" : "refused", status, { outcome: status === "rejected" ? "denied" : "cancelled" });
        }
      }
      if (Date.now() >= deadline) {
        try {
          await tend(`/api/v1/authorizations/${authorizationId}/cancel`, {});
        } catch {
          // Tend expires it on its own; it can't be used without a token we never claimed.
        }
        return stop("timeout", "no_decision");
      }
      await sleep(pollMs);
    }

    // 3. Spend the token, once, right before acting. No retry: after an ambiguous failure ask again.
    let used;
    try {
      used = await tend(`/api/v1/authorizations/${authorizationId}/consume`, { token, ...req });
    } catch (e) {
      return { ...(await stop(transient(e) ? "unavailable" : "refused", e.code)), ...(why(e) && { detail: why(e) }) };
    } finally {
      token = undefined;
    }
    if (used?.authorized !== true || used.authorizationId !== authorizationId || used.tool !== req.tool || used.action !== req.action
      || !same(used.resource, req.resource) || !same(used.detail, req.detail)) return stop("refused", "unexpected_response");

    // 4. Act. Tend has authorized this action; whether it worked is reported separately, by us, from here.
    let outcome = "success", result, error;
    try {
      result = await execute({ authorizationId });
    } catch (e) {
      outcome = "failure";
      error = "execution_failed";
      log(`  gate ${label} → authorized, but the action failed (${e?.name ?? "Error"})`);
    }
    try {
      await report({ ...req, outcome, authorizationId, ...(error && { error }) });
    } catch {
      // The authorization record shows it was consumed; the missing report is itself visible to operators.
    }
    return { executed: true, outcome, result, authorizationId };
  }

  return { run };
}

// ---- examples/claude-quickstart/tend-client.mjs ----------------------------------------------------------
// The one line a developer adds to an agent:  const gate = connectTend();
// Then wrap every sensitive tool:               await gate.run({ tool, action, resource, detail }, () => doTheRealThing());
// The tool function runs only if TEND allowed exactly that request (by policy, or because a person approved it); otherwise `gate.run`
// returns { executed: false, outcome, detail } and nothing happened. Settings come from the environment (TEND_URL, TEND_AGENT_KEY);
// a missing or rejected setting, or a TEND that is not running, produces a sentence saying what to do, never a stack trace.

export function connectTend({ url = process.env.TEND_URL ?? "http://localhost:3000", key = process.env.TEND_AGENT_KEY, onPending, log, ...options } = {}) {
  if (!key) {
    throw new Error(`TEND_AGENT_KEY is not set, so this agent has no identity at TEND.
Register the agent once (this also writes its key to .env.agent):
  npm run tester:agent -- "My agent" --rule my_tool:run:approve
then start your agent with:  node --env-file=.env.agent your-agent.mjs`);
  }
  const tend = async (path, body, headers = {}) => {
    let res;
    try {
      res = await fetch(url + path, {
        method: body ? "POST" : "GET",
        headers: { authorization: `Bearer ${key}`, ...(body && { "content-type": "application/json" }), ...headers },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw Object.assign(new Error(`TEND is not reachable at ${url}`), { code: "unreachable", hint: `TEND is not reachable at ${url}. Start it ("npm run dev", or "npm run demo" for a throwaway one) or set TEND_URL to the right address.` });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint = res.status === 401 ? `TEND at ${url} does not accept this agent key (${data.error ?? "unauthorized"}). It may have been revoked, or issued by a different TEND. Run "npm run tester:agent" again and restart the agent.` : undefined;
      throw Object.assign(new Error(`TEND ${res.status} ${data.error}: ${data.message}`), { status: res.status, code: data.error, body: data, ...(hint && { hint }) });
    }
    return data;
  };
  // Every outcome is reported to TEND's audit log as a tool.called event (what ran, or why not), exactly as authorized. A failed report never
  // changes the outcome: the authorization record already shows what TEND decided.
  const report = (data) => tend("/api/v1/events", { type: "tool.called", data });
  const gate = createGate({ tend, onPending, log, ...options });
  return { ...gate, run: (request, execute, rep = report) => gate.run(request, execute, rep) };
}

// ---- examples/mcp-proxy/tend-mcp-proxy.mjs ---------------------------------------------------------------
// TEND in front of any MCP server, for any MCP-capable agent (Claude Desktop, Claude Code, an Agents SDK, Hermes Agent, your own client).
// The agent's MCP host starts this proxy instead of the server; the proxy starts the real server and passes every message through untouched,
// EXCEPT `tools/call`: that is allowed only if TEND allows exactly that tool with exactly those arguments (by policy, or because a person approved
// it), and then it is forwarded once. Anything else (refused, rejected, expired, revoked, TEND unreachable) answers the host with a tool error and
// the real server never sees the call. Every decision and every forwarded call is in TEND's audit log.
//
//   In the MCP host's configuration, instead of  { "command": "npx", "args": ["-y", "some-mcp-server", ...] }  use:
//   { "command": "node", "args": ["/path/to/tend-mcp-proxy.mjs", "--", "npx", "-y", "some-mcp-server", ...],
//     "env": { "TEND_URL": "http://localhost:3000", "TEND_AGENT_KEY": "tend_sk_..." } }
//
// In TEND each MCP tool is a tool name with the action "call", for example a rule  { tool: "read_file", action: "call", effect: "allow" }.
// The approval shows the arguments; it is bound to all of them through a hash in `resource`, so a person approves exactly what will run.
// What this cannot stop: a host configured to start the real server directly, or a server that is reachable some other way. See docs/connectivity.md.
// Transport: MCP stdio (newline-delimited JSON-RPC 2.0). No dependencies.

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const log = (m) => process.stderr.write(`[tend-mcp-proxy] ${m}\n`); // stdout belongs to the protocol

const sha = (text) => createHash("sha256").update(text).digest("hex");
/**
 * The arguments as TEND's rules see them (`when` conditions): the same structure, with long strings and long lists replaced by their hash
 * and length, so the request stays small. Too large or too deep even then: null, and rules with conditions do not match (they fail closed).
 */
export function summarize(args) {
  const walk = (v, depth) => {
    if (typeof v === "string") return v.length <= 256 ? v : { sha256: sha(v), length: v.length };
    if (Array.isArray(v)) return v.length <= 50 && depth < 4 ? v.map((x) => walk(x, depth + 1)) : { sha256: sha(JSON.stringify(v)), length: v.length };
    if (v && typeof v === "object") return depth < 4 ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, depth + 1)])) : { sha256: sha(JSON.stringify(v)) };
    return typeof v === "number" || typeof v === "boolean" || v === null ? v : String(v);
  };
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const out = walk(args, 0);
  return JSON.stringify(out).length <= 3_500 ? out : null;
}

/** What TEND is asked for one tools/call: the tool, "call", a hash of the full arguments, the readable arguments (shortened if long) and their summary. */
export function toRequest(params) {
  const name = params?.name, args = params?.arguments ?? {};
  if (typeof name !== "string" || !ID.test(name)) return null;
  const text = JSON.stringify(args);
  const resource = `args:${sha(text).slice(0, 32)}`;
  const more = "… (shortened; bound to all arguments)"; // TEND accepts at most 200 characters of detail
  const detail = text.length <= 200 ? text : `${text.slice(0, 200 - more.length)}${more}`;
  const summary = summarize(args);
  return { tool: name, action: "call", resource, detail, ...(summary && Object.keys(summary).length && { args: summary }) };
}

/** A tool error the host shows to the model, so it can tell the user that the action did not happen. */
export const blocked = (id, why) => ({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Not done: TEND did not allow this tool call (${why}).` }], isError: true } });

export function startProxy({ command, args, gate, input = process.stdin, output = process.stdout, env = process.env }) {
  // The real server gets the environment minus TEND's settings: it never holds the agent's TEND key.
  const childEnv = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("TEND_")));
  const server = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"], env: childEnv });
  const send = (stream, msg) => stream.write(`${JSON.stringify(msg)}\n`);
  const pending = new Map(); // forwarded tools/call id -> resolve(response), so the result is known before it is reported
  server.on("exit", (code) => { log(`MCP server exited (${code})`); output.end?.(); });

  createInterface({ input: server.stdout }).on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return output.write(`${line}\n`); }
    if (msg && msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    output.write(`${line}\n`);
  });

  createInterface({ input }).on("line", async (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return server.stdin.write(`${line}\n`); }
    if (msg?.method !== "tools/call" || msg.id === undefined) return server.stdin.write(`${line}\n`);
    const req = toRequest(msg.params);
    if (!req) return send(output, blocked(msg.id, "tool name TEND cannot accept"));
    let response;
    const out = await gate.run(req, () => new Promise((resolve) => {
      pending.set(msg.id, resolve);
      server.stdin.write(`${line}\n`); // exactly what the host sent, once
    }).then((r) => { response = r; if (r.error || r.result?.isError) throw new Error("tool reported an error"); return "ok"; }));
    if (response) return send(output, response); // the server's own answer, whatever it was
    send(output, blocked(msg.id, `${out.outcome}${out.reason ? `: ${out.reason}` : ""}${out.detail ? `; ${out.detail}` : ""}`));
  }).on("close", () => server.stdin.end());
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (Number(process.versions.node.split(".")[0]) < 18) { console.error("Node 18 or newer is needed."); process.exit(2); }
  const sep = process.argv.indexOf("--");
  const [command, ...args] = sep > 0 ? process.argv.slice(sep + 1) : [];
  if (!command) {
    log('Usage: node tend-mcp-proxy.mjs -- <mcp server command> [args...]   (with TEND_URL and TEND_AGENT_KEY in the environment)');
    process.exit(2);
  }
  let gate;
  try {
    const timeout = Number(process.env.TEND_APPROVAL_TIMEOUT_MS ?? 120_000);
    gate = connectTend({ approvalTimeoutMs: timeout, onPending: () => log("waiting for a person to decide in TEND (Approvals, or: npm run tend -- pending)") });
  } catch (e) {
    log(e.message.split("\n")[0]);
    process.exit(2);
  }
  startProxy({ command, args, gate });
}

// ---- examples/adapters/guard.mjs -------------------------------------------------------------------------
// The one shared adapter: wrap a tool function so it runs only on TEND's yes. Every framework adapter in this folder (and the MCP proxy)
// asks TEND the same way: tool name, action "call", a hash of all arguments as the resource, the readable arguments as the detail.
//
//   const gate = connectTend();                                       // examples/claude-quickstart/tend-client.mjs
//   const readNote = guardTool(gate, "read_note", async (args) => ...); // then hand readNote to your framework as the tool body
//
// The wrapped function returns the tool's own result when TEND allowed it, and otherwise a sentence that starts with "Not done", so the
// model can tell the user the action did not happen. It never throws for a refusal: frameworks differ in what an exception does.

/** Why it did not happen, in words a developer can act on. The code stays in parentheses for searching logs. */
const HINTS = {
  no_policy: (t) => `no rule for ${t} · call yet: add one in TEND (Policies, "Your agent's own tools")`,
  policy_denied: () => "the policy says never",
  invalid_policy: () => "the saved policy cannot be read, so everything is blocked",
  rejected: () => "a person rejected it",
  expired: () => "nobody decided in time",
  no_decision: () => "nobody decided in time",
  not_permitted: () => "the policy or the agent changed before it ran",
  already_consumed: () => "this exact call was already authorized once, and is not run twice",
  invalid_key: () => "TEND does not accept this agent key (revoked, or from another TEND: check TEND_URL and TEND_AGENT_KEY)",
  agent_paused: () => "the agent is paused in TEND",
};
/** The text a model sees when TEND did not allow a call. */
export const notDone = (out, tool = "this tool") => {
  const hint = HINTS[out.reason]?.(tool) ?? HINTS[out.outcome]?.(tool);
  return `Not done: TEND did not allow this tool call (${out.outcome}${out.reason ? `: ${out.reason}` : ""}${hint ? `; ${hint}` : ""}${out.detail ? `; ${out.detail}` : ""}).`;
};
/**
 * Wraps a tool function. The function receives a private copy of the arguments, taken when TEND was asked, so what runs is exactly what was
 * authorized even if the caller changes its own object afterwards. Pass the framework's tool-call id as the second argument when it has one:
 * the same call delivered twice then runs once.
 */
export function guardTool(gate, name, fn) {
  return async (args = {}, callId) => {
    let snapshot;
    try {
      snapshot = structuredClone(args);
    } catch {
      return notDone({ outcome: "refused", reason: "arguments that cannot be copied" }, name);
    }
    const request = toRequest({ name, arguments: snapshot });
    if (!request) return notDone({ outcome: "refused", reason: "tool name TEND cannot accept" }, name);
    const key = typeof callId === "string" && callId ? `call-${callId}`.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 64) : undefined;
    const out = await gate.run({ ...request, ...(key && { idempotencyKey: key }) }, () => fn(snapshot));
    if (!out.executed) return notDone(out, name);
    return out.outcome === "success" ? out.result : "TEND allowed this call, but the tool itself failed.";
  };
}

// ---- examples/adapters/openai-compatible.mjs -------------------------------------------------------------
// One adapter for every provider that speaks the OpenAI-compatible Chat Completions API: OpenAI, Google Gemini, Mistral, Groq, Ollama,
// Anthropic's compatibility endpoint, and any self-hosted server with the same API. A small tool loop with no dependencies; each tool body
// is expected to be wrapped with guardTool() so it runs only on TEND's yes.
//
//   const out = await runChatAgent({ provider: "groq", model: "llama-3.3-70b-versatile", tools, prompt });
//   tools: [{ name, description, params: { field: "description" }, run: guardTool(gate, name, fn) }]
export const PROVIDERS = {
  openai: { baseURL: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY" },
  gemini: { baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY" },
  mistral: { baseURL: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY" },
  groq: { baseURL: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY" },
  ollama: { baseURL: "http://127.0.0.1:11434/v1", keyEnv: null }, // local: no key
  anthropic: { baseURL: "https://api.anthropic.com/v1", keyEnv: "ANTHROPIC_API_KEY" }, // Anthropic's OpenAI SDK compatibility endpoint
};

const fnSpec = (t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: { type: "object", properties: Object.fromEntries(Object.entries(t.params).map(([k, d]) => [k, { type: "string", description: d }])), required: Object.keys(t.params) } } });

/**
 * @returns { final, usage: { in, out, calls }, toolCalls: [{ name, args }], error? }   error is set (and nothing more runs) on any API failure.
 */
export async function runChatAgent({ provider, baseURL = PROVIDERS[provider]?.baseURL, apiKey = PROVIDERS[provider]?.keyEnv ? process.env[PROVIDERS[provider].keyEnv] : "local", model, tools, system, prompt, maxTurns = 4, maxTokens = 400, timeoutMs = 60_000 }) {
  const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }];
  const usage = { in: 0, out: 0, calls: 0 }, toolCalls = [];
  for (let turn = 0; turn < maxTurns; turn++) {
    let res, data;
    try {
      res = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages, tools: tools.map(fnSpec) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      data = await res.json();
    } catch (e) {
      return { final: "", usage, toolCalls, error: `provider unreachable (${e.name})` };
    }
    if (!res.ok) return { final: "", usage, toolCalls, error: `provider ${res.status}: ${String(data?.error?.message ?? data?.error ?? "").slice(0, 160)}` };
    usage.in += data.usage?.prompt_tokens ?? 0;
    usage.out += data.usage?.completion_tokens ?? 0;
    usage.calls++;
    const msg = data.choices?.[0]?.message ?? {};
    const calls = msg.tool_calls ?? [];
    messages.push({ role: "assistant", content: msg.content ?? "", ...(calls.length && { tool_calls: calls }) });
    if (!calls.length) return { final: msg.content ?? "", usage, toolCalls };
    for (const c of calls) {
      let args = {};
      try { args = JSON.parse(c.function?.arguments || "{}"); } catch { /* the tool gets {} and says what is missing */ }
      const tool = tools.find((t) => t.name === c.function?.name);
      toolCalls.push({ name: c.function?.name, args });
      const result = tool ? await tool.run(args) : `There is no tool named ${c.function?.name}.`;
      messages.push({ role: "tool", tool_call_id: c.id, content: String(result) });
    }
  }
  return { final: "", usage, toolCalls, stopped: "max_turns" };
}
