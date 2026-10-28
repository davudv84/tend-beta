#!/usr/bin/env node
// Interactive demonstration: a real (or scripted) Claude Haiku agent organizes fake notes. Every file
// operation goes through Tend's execution gateway on an isolated server this script starts itself:
// a fresh embedded database and a fresh notes directory in temp dirs, a random throwaway admin token,
// demo off, no DATABASE_URL. The agent has no filesystem access.
//
// Approvals are NOT simulated. When the agent asks to act, Tend creates a pending authorization and
// this process waits. Sign in at /operator and decide under Oversight → Authorizations.
//
//   npm run demo:claude-notes                 real claude-haiku-4-5 (needs ANTHROPIC_API_KEY, cap $0.50)
//   npm run demo:claude-notes -- --scripted   playback, no model calls
//
// Does not push, deploy or merge. Cleans up temp dirs on exit.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { notesAnthropic, runNotesAgent, scriptedNotesModel } from "../examples/claude-agent/notes-agent.mjs";
import { tendHttp } from "../examples/claude-agent/agent.mjs";

const scripted = process.argv.includes("--scripted");
const MAX_USD = Number(process.env.MAX_USD ?? "0.5");
const API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
if (!scripted && !API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set; nothing was run. Put it in .env.local, or pass --scripted.");
  process.exit(2);
}

const PORT = 4100 + Math.floor(Math.random() * 80);
const URL_ = `http://127.0.0.1:${PORT}`;
const ADMIN = `fake_admin_${randomBytes(18).toString("hex")}`;
const dataDir = mkdtempSync(path.join(tmpdir(), "tend-notes-demo-db-"));
const notesDir = mkdtempSync(path.join(tmpdir(), "tend-notes-demo-notes-"));

const SEED = {
  standup: "FICTIONAL standup: Anna owns the Q4 plan.",
  printer: "FICTIONAL errand: order printer paper on Monday.",
  garden: "FICTIONAL idea: plant herbs by the north wall.",
};
for (const [name, text] of Object.entries(SEED)) writeFileSync(path.join(notesDir, `${name}.txt`), `${text}\n`);

// The server never sees the Anthropic key or a real database. NODE_ENV is left unset so the operator
// cookie works in a local browser over HTTP (Secure cookies would not).
const env = {
  ...process.env,
  TEND_ADMIN_TOKEN: ADMIN,
  TEND_GATEWAY_NOTES_DIR: notesDir,
  TEND_DATA_DIR: dataDir,
  TEND_DEMO: "0",
  TEND_PUBLIC: "0",
  DATABASE_URL: "",
  POSTGRES_URL: "",
  ANTHROPIC_API_KEY: "",
  TEND_GATEWAY_PAYMENTS_KEY: "",
};
delete env.NODE_ENV;
// This process plays the agent too. Whatever the server needs is in `env` above; take it out of our own environment
// so the agent side holds no credential to the notes directory, the database or the admin token (runNotesAgent checks).
for (const k of Object.keys(process.env)) if (/^(TEND_GATEWAY_|TEND_ADMIN_TOKEN$|TEND_DATA_DIR$|DATABASE_URL$|POSTGRES_URL$)/.test(k)) delete process.env[k];

// next dev so this isolated instance serves the current source, not a stale production build.
const server = spawn("npx", ["next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], { env, stdio: ["ignore", "pipe", "pipe"] });
let serverOut = "";
server.stdout.on("data", (b) => (serverOut += b.toString()));
server.stderr.on("data", (b) => (serverOut += b.toString()));

const files = () => readdirSync(notesDir).sort();
let cookie = "";

async function call(method, p, { body, key, op } = {}) {
  const res = await fetch(URL_ + p, {
    method,
    headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(key && { authorization: `Bearer ${key}` }), ...(op && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

function cleanup() {
  try {
    server.kill("SIGTERM");
  } catch {
    // already gone
  }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(notesDir, { recursive: true, force: true });
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

const source = scripted ? "scripted" : "real-model";
console.log(`
TEND notes demo — isolated, fake data only
  source:     ${source === "real-model" ? "REAL Claude Haiku 4.5 API calls" : "SIMULATED tool-call playback (no Anthropic)"}
  Tend:       always real (this process's server, temp database)
  files:      only via POST /api/v1/gateway/execute after a consumed authorization
  database:   ${dataDir}
  notes dir:  ${notesDir}   (seeded: ${files().join(", ")})
  budget cap: $${MAX_USD.toFixed(2)}

Sign in, then approve or reject each waiting action in the dashboard:
  ${URL_}/operator     token: ${ADMIN}
  ${URL_}/oversight    → Authorizations
The agent continues automatically after you decide. Rejecting prevents execution.
`);

try {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error(`server exited: ${serverOut.slice(-800)}`);
    if (i > 180) throw new Error("server did not start within 90s");
    if (await fetch(`${URL_}/api/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const login = await call("POST", "/api/operator/session", { body: { token: ADMIN } });
  if (login.status !== 200) throw new Error(`operator sign-in failed: ${login.status}`);
  cookie = login.headers.get("set-cookie").split(";")[0];

  const beforePolicy = await call("POST", "/api/v1/agents", { op: true, body: { name: "Notes clerk", model: scripted ? "scripted" : "claude-haiku-4-5", provider: "Anthropic", role: "Notes clerk (isolated demo)" } });
  if (beforePolicy.status !== 201) throw new Error(`register failed: ${beforePolicy.status} ${JSON.stringify(beforePolicy.body)}`);
  const agentKey = beforePolicy.body.apiKey;
  const agentId = beforePolicy.body.agent.id;

  const unauthorized = await call("POST", "/api/v1/gateway/requests", { key: agentKey, body: { tool: "list_notes", params: {} } });
  if (unauthorized.status !== 403 || unauthorized.body?.reason !== "no_policy") throw new Error(`expected no_policy deny, got ${unauthorized.status} ${JSON.stringify(unauthorized.body)}`);
  if (files().includes("inbox-summary.txt")) throw new Error("unauthorized list must not write");
  console.log("[setup] no policy: list_notes denied, directory unchanged.");

  const policy = await call("POST", `/api/v1/agents/${agentId}/policy`, {
    op: true,
    body: {
      enforcement: "enforce",
      rules: [
        { tool: "list_notes", action: "list", effect: "approve" },
        { tool: "read_note", action: "read", effect: "approve" },
        { tool: "write_note", action: "create", effect: "approve" },
      ],
    },
  });
  if (policy.status !== 200) throw new Error(`policy failed: ${policy.status}`);
  console.log("[setup] policy is approve-only (no allow). Every file operation waits for you in the dashboard.\n");

  const claude = scripted ? null : notesAnthropic({ apiKey: API_KEY, maxUsd: MAX_USD });
  const started = Date.now();
  const out = await runNotesAgent({
    model: scripted ? scriptedNotesModel() : claude.call,
    tend: tendHttp(URL_, agentKey, { timeoutMs: 15_000 }),
    env: process.env,
    approvalTimeoutMs: Number(process.env.APPROVAL_TIMEOUT_MS ?? "600000"),
    pollMs: 2_000,
    log: console.log,
    source,
    onPending: ({ authorizationId, tool, resource, detail }) => {
      console.log(`
[waiting on dashboard — not auto-approved]
  tool:     ${tool}
  resource: ${resource ?? ""}
  detail:   ${detail ?? ""}
  id:       ${authorizationId}
  open:     ${URL_}/oversight
`);
    },
  });

  console.log(JSON.stringify({
    source,
    seconds: Math.round((Date.now() - started) / 1000),
    calls: out.calls.map((c) => ({ tool: c.tool, executed: c.executed, outcome: c.outcome, reason: c.reason, authorizationId: c.authorizationId })),
    finalAnswer: out.finalAnswer,
    notesAfter: files(),
    usage: claude?.usage ?? null,
  }, null, 2));
} catch (e) {
  console.error(e.message);
  console.error(serverOut.slice(-800));
  cleanup();
  process.exit(1);
}

cleanup();
process.exit(0);
