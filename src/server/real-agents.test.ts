// LOCAL INTEGRATION TESTS for the OpenAI and Anthropic agents (examples/real-agents).
//
// What is real: the official SDKs (@openai/agents, @anthropic-ai/sdk) and their request/response handling, the example agents,
// the gateway client, TEND's real request handlers over a real HTTP port, the in-memory database and a real temporary sandbox folder.
// What is NOT real: the model. Each SDK is pointed (via baseURL) at a small local server that plays back scripted tool calls.
// These tests prove TEND's controls and the adapters' behaviour; they do NOT prove that a particular live model behaves well.
// The real-provider run is scripts/real-agents-e2e.mjs.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { fakeAnthropic, fakeOpenAI, listen } from "../../scripts/fake-models.mjs";
import { runAnthropicAgent } from "../../examples/real-agents/anthropic-agent.mjs";
import { runOpenAIAgent } from "../../examples/real-agents/openai-agent.mjs";
import { tendHttp } from "../../examples/real-agents/toolbox.mjs";
import { authAgent } from "./agent-auth.ts";
import { claimToken } from "./authz.ts";
import { memoryDb, type DB } from "./db.ts";
import { executeTool, requestExecution } from "./gateway.ts";
import { json, readJson, route } from "./http.ts";
import { decide, inbox, registerAgent, revokeKey, setPolicy } from "./repo.ts";

const POLICY = [
  { tool: "read_test_file", action: "read", effect: "allow" },
  { tool: "write_test_file", action: "create", effect: "approve" },
  { tool: "delete_test_file", action: "delete", effect: "deny" },
];

// ---- TEND over HTTP, the same handlers the routes use ------------------------------------------------------------

function serveTend(db: DB) {
  const handle = route(async (req) => {
    const p = new URL(req.url).pathname;
    const agent = await authAgent(db, req);
    if (req.method === "GET" && p === "/api/v1/agent/inbox") return json({ agentId: agent.id, ...(await inbox(db, agent)) });
    if (req.method === "POST" && p === "/api/v1/events") {
      const { ingestEvents } = await import("./repo.ts");
      return json(await ingestEvents(db, agent, [await readJson(req)]), 202);
    }
    if (req.method === "POST" && p === "/api/v1/gateway/requests") {
      const { view, created } = await requestExecution(db, agent, await readJson(req, 4_096), req.headers.get("idempotency-key"));
      return json(view, view.status === "denied" ? 403 : created ? 201 : 200);
    }
    const token = p.match(/^\/api\/v1\/authorizations\/([^/]+)\/token$/);
    if (req.method === "POST" && token) {
      const { view } = await claimToken(db, agent, token[1]);
      return json(view, view.status === "pending" ? 202 : 200);
    }
    const cancel = p.match(/^\/api\/v1\/authorizations\/([^/]+)\/cancel$/);
    if (req.method === "POST" && cancel) {
      await (await import("./authz.ts")).cancelAuthorization(db, agent, cancel[1]);
      return json({ status: "cancelled" });
    }
    if (req.method === "POST" && p === "/api/v1/gateway/execute") return json(await executeTool(db, agent, await readJson(req, 4_096)));
    return json({ error: "not_found" }, 404);
  });
  return listen(async (nreq, nres) => {
    const chunks: Buffer[] = [];
    for await (const c of nreq) chunks.push(c as Buffer);
    const body = ["GET", "HEAD"].includes(nreq.method!) ? undefined : Buffer.concat(chunks);
    const res = await handle(new Request(`http://127.0.0.1${nreq.url}`, { method: nreq.method, headers: nreq.headers as HeadersInit, body }), undefined as never);
    nres.writeHead(res.status, Object.fromEntries(res.headers));
    nres.end(await res.text());
  });
}

// ---- fake model servers: scripts/fake-models.mjs (scripted tool calls; they record what the model was told) --------------

interface Call { name: string; input: Record<string, string>; id?: string }
type Script = { turns: Call[][]; final: string };

// ---- one fixture per test ------------------------------------------------------------------------------------------

async function fixture(policy: unknown = POLICY, provider: "OpenAI" | "Anthropic" = "OpenAI") {
  const dir = mkdtempSync(path.join(tmpdir(), "tend-agents-sandbox-"));
  writeFileSync(path.join(dir, "hello.txt"), "Hello from the sandbox.\n");
  process.env.TEND_GATEWAY_SANDBOX_DIR = dir;
  const db = await memoryDb();
  const { agent, apiKey } = await registerAgent(db, { name: `${provider} test agent`, model: "m", provider });
  await setPolicy(db, agent.id, policy, "enforce");
  const tend = await serveTend(db);
  const files = () => Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(path.join(dir, f), "utf8")]));
  const cleanup = async () => {
    delete process.env.TEND_GATEWAY_SANDBOX_DIR;
    await tend.close();
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  };
  /** The person at the dashboard: decides each pending request when `decider` says so. */
  const human = (decider: (a: { id: string; tool: string; resource: string | null; detail: string | null }) => "approved" | "rejected" | "wait") => {
    let running = true;
    const seen: { id: string; tool: string; resource: string | null; detail: string | null; filesWhilePending: Record<string, string> }[] = [];
    const done = (async () => {
      while (running) {
        const rows = await db.all<{ id: string; tool: string; resource: string | null; detail: string | null }>("SELECT id, tool, resource, detail FROM authorizations WHERE status = 'pending' AND agent_id = ?", agent.id);
        for (const r of rows) {
          if (!seen.some((s) => s.id === r.id)) seen.push({ ...r, filesWhilePending: files() });
          const verdict = decider(r);
          if (verdict !== "wait") await decide(db, r.id, verdict);
        }
        await new Promise((r) => setTimeout(r, 15));
      }
    })();
    return { seen, stop: async () => { running = false; await done; } };
  };
  return { db, dir, agent, apiKey, tend, files, human, cleanup };
}
type F = Awaited<ReturnType<typeof fixture>>;

const AGENT_ENV = { PATH: "/usr/bin" }; // what an agent process holds: nothing of the server's
const FAST = { pollMs: 15, approvalTimeoutMs: 15_000 };

const PROVIDERS = [
  {
    name: "Anthropic",
    async run(f: F, script: Script, over: Record<string, unknown> = {}) {
      const fake = await fakeAnthropic(script);
      try {
        const client = new Anthropic({ apiKey: "fake-anthropic-key", baseURL: fake.url, maxRetries: 0 });
        const out = await runAnthropicAgent({ client, tend: tendHttp(f.tend.url, f.apiKey), env: AGENT_ENV, ...FAST, ...over });
        return { out, told: fake.told };
      } catch (e) {
        return { error: e as Error, told: fake.told };
      } finally {
        await fake.close();
      }
    },
  },
  {
    name: "OpenAI",
    async run(f: F, script: Script, over: Record<string, unknown> = {}) {
      const fake = await fakeOpenAI(script);
      try {
        const openaiClient = new OpenAI({ apiKey: "fake-openai-key", baseURL: `${fake.url}/v1`, maxRetries: 0 });
        const out = await runOpenAIAgent({ openaiClient, tend: tendHttp(f.tend.url, f.apiKey), env: AGENT_ENV, ...FAST, ...over });
        return { out, told: fake.told };
      } catch (e) {
        return { error: e as Error, told: fake.told };
      } finally {
        await fake.close();
      }
    },
  },
] as const;

const READ: Call = { name: "read_test_file", input: { path: "hello.txt" } };
const WRITE: Call = { name: "write_test_file", input: { path: "agent-note.txt", text: "Written by an AI agent through TEND." } };
const DELETE: Call = { name: "delete_test_file", input: { path: "hello.txt" } };
const gwOutcomes = async (db: DB) => (await db.all<{ data: string }>("SELECT data FROM events WHERE type = 'tool.called'")).map((r) => JSON.parse(r.data)).filter((d) => d.via === "gateway");

for (const P of PROVIDERS) {
  const prov = P.name;

  test(`${prov}: read is allowed, write waits for a person and then happens once, delete is denied and nothing is deleted`, async () => {
    const f = await fixture(POLICY, prov);
    const human = f.human((a) => (a.tool === "write_test_file" ? "approved" : "wait"));
    try {
      const r = await P.run(f, { turns: [[READ], [WRITE], [DELETE]], final: "done" });
      await human.stop();
      assert.ok(r.out, r.error?.message);
      const by = Object.fromEntries(r.out!.calls.map((c) => [c.tool, c]));
      assert.equal(by.read_test_file.executed, true);
      assert.equal(by.write_test_file.executed, true);
      assert.equal(by.delete_test_file.executed, false);
      assert.deepEqual([by.delete_test_file.outcome, by.delete_test_file.reason], ["denied", "policy_denied"]);

      // The model really was handed the file text through TEND, and the refusal as an error.
      assert.ok(r.told.some((t) => t.includes("Hello from the sandbox.")), "the read result reached the model");
      assert.ok(r.told.some((t) => /Not executed \(denied: policy_denied\)/.test(t)), "the denial reached the model");

      // The write was pending, the file did not exist while it waited, then it holds exactly the approved bytes.
      assert.equal(human.seen.length, 1, "only the write ever needed a person");
      assert.deepEqual([human.seen[0].tool, human.seen[0].resource, human.seen[0].detail], ["write_test_file", "agent-note.txt", "Written by an AI agent through TEND."]);
      assert.equal("agent-note.txt" in human.seen[0].filesWhilePending, false);
      assert.deepEqual(f.files(), { "hello.txt": "Hello from the sandbox.\n", "agent-note.txt": "Written by an AI agent through TEND.\n" });

      // Audit: one success per executed call, one denial, all with authorization ids; the run was reported to TEND.
      const o = await gwOutcomes(f.db);
      assert.deepEqual(o.map((x) => [x.tool, x.outcome]).sort(), [["read_test_file", "success"], ["write_test_file", "success"]]);
      const denied = await f.db.all<{ tool: string; status: string }>("SELECT tool, status FROM authorizations WHERE status = 'denied'");
      assert.deepEqual(denied.map((d) => d.tool), ["delete_test_file"]);
      const events = (await f.db.all<{ type: string }>("SELECT type FROM events")).map((e) => e.type);
      assert.ok(events.includes("task.started") && events.includes("task.completed"));
      const everything = (await f.db.all<{ data: string }>("SELECT data FROM events")).map((e) => e.data).join("\n");
      assert.equal(everything.includes(f.apiKey), false, "the agent key is not in the log");
      assert.equal(everything.includes("fake-openai-key") || everything.includes("fake-anthropic-key"), false, "the provider key never reaches TEND");
    } finally {
      await human.stop();
      await f.cleanup();
    }
  });

  test(`${prov}: a rejected write never happens and the model is told so`, async () => {
    const f = await fixture(POLICY, prov);
    const human = f.human(() => "rejected");
    try {
      const r = await P.run(f, { turns: [[WRITE]], final: "it was refused" });
      await human.stop();
      assert.ok(r.out, r.error?.message);
      assert.deepEqual([r.out!.calls[0].executed, r.out!.calls[0].outcome], [false, "rejected"]);
      assert.deepEqual(Object.keys(f.files()), ["hello.txt"]);
      assert.ok(r.told.some((t) => /Not executed \(rejected/.test(t)));
      assert.equal((await gwOutcomes(f.db)).length, 0, "the gateway never ran or recorded a write");
    } finally {
      await human.stop();
      await f.cleanup();
    }
  });

  test(`${prov}: an approval that nobody gives in time ends in a timeout and no write`, async () => {
    const f = await fixture(POLICY, prov);
    try {
      const r = await P.run(f, { turns: [[WRITE]], final: "gave up" }, { approvalTimeoutMs: 300 });
      assert.ok(r.out, r.error?.message);
      assert.deepEqual([r.out!.calls[0].executed, r.out!.calls[0].outcome], [false, "timeout"]);
      assert.deepEqual(Object.keys(f.files()), ["hello.txt"]);
      const row = await f.db.get<{ status: string }>("SELECT status FROM authorizations WHERE tool = 'write_test_file'");
      assert.equal(row!.status, "cancelled", "the agent withdrew the request, so a late click cannot run it");
    } finally {
      await f.cleanup();
    }
  });

  test(`${prov}: a repeated provider call id makes one request; the same call under two ids needs two approvals`, async () => {
    const f = await fixture(POLICY, prov);
    const human = f.human((a) => (a.resource === "agent-note.txt" ? "approved" : "wait"));
    try {
      const same = await P.run(f, { turns: [[{ ...WRITE, id: "call_same" }, { ...WRITE, id: "call_same" }]], final: "ok" });
      await human.stop();
      assert.ok(same.out, same.error?.message);
      assert.equal(human.seen.length, 1, "a repeated id is answered from the first call");
      assert.equal(same.out!.calls.filter((c) => c.executed).length, 1);
      assert.equal(f.files()["agent-note.txt"], "Written by an AI agent through TEND.\n");
    } finally {
      await human.stop();
      await f.cleanup();
    }

    const g = await fixture(POLICY, prov);
    // Both are identical writes under different ids. Only the first is approved; the second is rejected by the person.
    let first = true;
    const human2 = g.human(() => (first ? ((first = false), "approved") : "rejected"));
    try {
      const two = await P.run(g, { turns: [[{ ...WRITE, id: "call_a" }, { ...WRITE, id: "call_b" }]], final: "ok" });
      await human2.stop();
      assert.ok(two.out, two.error?.message);
      assert.equal(human2.seen.length, 2, "each call id is its own request and its own decision");
      assert.deepEqual(two.out!.calls.map((c) => c.executed).sort(), [false, true]);
      assert.equal(readdirSync(g.dir).filter((n) => n === "agent-note.txt").length, 1);
    } finally {
      await human2.stop();
      await g.cleanup();
    }
  });

  test(`${prov}: a key revoked while a write is waiting cancels it; nothing is written even if a person then clicks approve`, async () => {
    const f = await fixture(POLICY, prov);
    try {
      const run = P.run(f, { turns: [[WRITE]], final: "stopped" });
      let pending: string | undefined;
      for (let i = 0; i < 400 && !pending; i++) {
        pending = (await f.db.get<{ id: string }>("SELECT id FROM authorizations WHERE status = 'pending'"))?.id;
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.ok(pending, "the request reached TEND");
      await revokeKey(f.db, f.agent.id);
      await assert.rejects(decide(f.db, pending!, "approved"), "the cancelled request can no longer be approved");
      const r = await run;
      // The run ends in failure (the agent's own key stopped working, even for reporting), never in a write.
      assert.ok(r.error ? /invalid_key|revoked|401/.test(r.error.message) : r.out!.calls.every((c) => !c.executed), "the run failed closed");
      assert.deepEqual(Object.keys(f.files()), ["hello.txt"]);
      // The revoked key cannot start another run at all.
      const again = await P.run(f, { turns: [[READ]], final: "x" });
      assert.ok(again.error, "a run with a revoked key fails closed");
      assert.equal(again.out, undefined);
    } finally {
      await f.cleanup();
    }
  });

  test(`${prov}: if TEND goes away mid-run, protected actions are not executed`, async () => {
    const f = await fixture(POLICY, prov);
    const human = f.human(() => "approved");
    try {
      let killed = false;
      // The model asks to read (works), then TEND is stopped, then the model asks to write.
      const r = await P.run(f, { turns: [[READ], [WRITE]], final: "ok" }, {
        log: (line: string) => { if (!killed && line.includes("→ executed")) { killed = true; void f.tend.close(); } },
        approvalTimeoutMs: 1_500,
      });
      await human.stop();
      assert.ok(killed, "the first call ran while TEND was up");
      // The run may fail while reporting to a dead TEND; either way no file appeared.
      const calls = r.out?.calls ?? [];
      assert.ok(calls.every((c) => c.tool !== "write_test_file" || c.executed === false));
      assert.deepEqual(Object.keys(f.files()), ["hello.txt"]);
    } finally {
      await human.stop();
      await f.cleanup();
    }
  });

  test(`${prov}: a key TEND rejects (rotated, revoked or from another server) stops the run with an explanation, not a bare 401`, async () => {
    const f = await fixture(POLICY, prov);
    try {
      await revokeKey(f.db, f.agent.id);
      const keyInfo = { key: f.apiKey, source: ".env.agent", url: f.tend.url };
      const r = await P.run(f, { turns: [[WRITE]], final: "x" }, { keyInfo });
      assert.equal(r.out, undefined, "no run happened");
      const msg = r.error?.message ?? "";
      assert.match(msg, /rejected this agent's key \(401 invalid_key\)/);
      assert.match(msg, /came from \.env\.agent/);
      assert.ok(msg.includes(f.apiKey.slice(0, 14)), "the key prefix identifies which key it was");
      assert.equal(msg.includes(f.apiKey), false, "the key itself is never shown");
      assert.match(msg, /agents:setup -- --check/);
      assert.deepEqual(Object.keys(f.files()), ["hello.txt"]);
    } finally {
      await f.cleanup();
    }
  });

  test(`${prov}: with TEND unreachable at the start the agent does not run at all`, async () => {
    const f = await fixture(POLICY, prov);
    await f.tend.close();
    try {
      const r = await P.run(f, { turns: [[WRITE]], final: "x" }, { keyInfo: { key: f.apiKey, source: ".env.agent", url: f.tend.url } });
      assert.match(r.error?.message ?? "", /Could not reach TEND at http:\/\/127\.0\.0\.1:\d+/);
      assert.deepEqual(Object.keys(f.files()), ["hello.txt"]);
    } finally {
      await f.cleanup();
    }
  });

  test(`${prov}: the agent refuses to start if its environment holds server secrets, before any request`, async () => {
    const f = await fixture(POLICY, prov);
    try {
      for (const env of [{ TEND_GATEWAY_SANDBOX_DIR: f.dir }, { TEND_ADMIN_TOKEN: "x".repeat(30) }, { DATABASE_URL: "postgres://x" }]) {
        const r = await P.run(f, { turns: [[READ]], final: "x" }, { env });
        assert.match(r.error?.message ?? "", /Refusing to run/);
      }
      assert.equal((await f.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM authorizations"))!.n, 0, "no request was made");
    } finally {
      await f.cleanup();
    }
  });

  test(`${prov}: a tool the gateway does not have is refused locally and never reaches TEND`, async () => {
    const f = await fixture(POLICY, prov);
    try {
      const r = await P.run(f, { turns: [[{ name: "run_shell", input: { path: "ls" } }]], final: "x" });
      // Anthropic hands unknown tools to our loop (refused there); the OpenAI SDK refuses them itself. Neither reaches TEND.
      const refused = r.out ? r.out.calls.every((c) => c.executed === false) : true;
      assert.ok(refused);
      assert.equal((await f.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM authorizations"))!.n, 0);
    } finally {
      await f.cleanup();
    }
  });
}

test("a path traversal attempt from the model is refused by TEND and touches nothing outside the sandbox", async () => {
  for (const P of PROVIDERS) {
    const f = await fixture([{ tool: "read_test_file", action: "read", effect: "allow" }, { tool: "write_test_file", action: "create", effect: "allow" }, { tool: "delete_test_file", action: "delete", effect: "allow" }], P.name);
    const outside = mkdtempSync(path.join(tmpdir(), "tend-agents-outside-"));
    writeFileSync(path.join(outside, "secret.txt"), "SECRET\n");
    try {
      const evil = ["../secret.txt", `${outside}/secret.txt`, "a/../../secret.txt", "..%2fsecret.txt"];
      const r = await P.run(f, { turns: [evil.flatMap((p): Call[] => [{ name: "read_test_file", input: { path: p } }, { name: "write_test_file", input: { path: p, text: "x" } }, { name: "delete_test_file", input: { path: p } }])], final: "x" });
      assert.ok(r.out, r.error?.message);
      assert.ok(r.out!.calls.length >= 12 && r.out!.calls.every((c) => c.executed === false), `${P.name}: nothing executed`);
      assert.ok(r.out!.calls.every((c) => c.outcome === "refused"));
      assert.equal(readFileSync(path.join(outside, "secret.txt"), "utf8"), "SECRET\n");
      assert.deepEqual(Object.keys(f.files()), ["hello.txt"]);
      assert.equal(existsSync(path.join(outside, "x")), false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
      await f.cleanup();
    }
  }
});

test("the example agents contain no path around TEND: no filesystem, process or raw network access", () => {
  const dir = path.resolve(import.meta.dirname, "../../examples/real-agents");
  for (const file of ["toolbox.mjs", "openai-agent.mjs", "anthropic-agent.mjs", "env.mjs"]) {
    const src = readFileSync(path.join(dir, file), "utf8");
    const imports = [...src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
    const banned = imports.filter((i) => /^(node:)?(fs|fs\/promises|child_process|net|http|https|dgram|worker_threads|vm)$/.test(i));
    // env.mjs reads two env files (never the sandbox); every other file must not touch the filesystem at all.
    const allowed = file === "env.mjs" ? banned.filter((i) => !/^(node:)?fs$/.test(i)) : banned;
    assert.deepEqual(allowed, [], `${file} imports ${allowed}`);
    assert.equal(/TEND_GATEWAY_|SANDBOX_DIR|\bexec(Sync)?\(|\bspawn\(|\beval\(|new Function/.test(src.replace(/\/\/.*$/gm, "")), false, `${file} references server credentials or runs code`);
  }
});
