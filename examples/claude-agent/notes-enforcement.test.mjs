// Regression tests for the supported integration (Claude notes agent + gateway): protected file operations happen
// only through Tend, only after approval, and only once. In-memory Tend, temp notes directory, scripted model.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cancelAuthorization, claimToken, consumeAuthorization } from "../../src/server/authz.ts";
import { memoryDb } from "../../src/server/db.ts";
import { executeTool, requestExecution } from "../../src/server/gateway.ts";
import { HttpError } from "../../src/server/http.ts";
import { decide, getAgent, inbox, ingestEvents, registerAgent, setPolicy } from "../../src/server/repo.ts";
import { assertNoDirectAccess, IsolationError } from "./isolation.mjs";
import { NOTES_TOOLS, runNotesAgent, scriptedNotesModel } from "./notes-agent.mjs";

const POLICY = [
  { tool: "list_notes", action: "list", effect: "approve" },
  { tool: "read_note", action: "read", effect: "approve" },
  { tool: "write_note", action: "create", effect: "approve" },
];
const SEED = { standup: "FICTIONAL standup: Anna owns the Q4 plan.", printer: "FICTIONAL errand: order printer paper.", garden: "FICTIONAL idea: plant herbs." };
const FORGED = `tend_az_${"A".repeat(43)}`;

function localTend(db, agentId, calls) {
  return async (pathName, body, headers = {}) => {
    calls?.push(pathName);
    const agent = await getAgent(db, agentId);
    try {
      const m = pathName.match(/^\/api\/v1\/authorizations\/([^/]+)\/(token|consume|cancel)$/);
      if (pathName === "/api/v1/gateway/requests") {
        const { view } = await requestExecution(db, agent, body, headers["Idempotency-Key"] ?? null);
        if (view.status === "denied") throw Object.assign(new Error("Tend 403"), { status: 403, code: "not_authorized", body: view });
        return view;
      }
      if (pathName === "/api/v1/gateway/execute") return await executeTool(db, agent, body);
      if (m?.[2] === "token") return (await claimToken(db, agent, m[1])).view;
      if (m?.[2] === "consume") return await consumeAuthorization(db, agent, m[1], body);
      if (m?.[2] === "cancel") return await cancelAuthorization(db, agent, m[1]);
      if (pathName === "/api/v1/events") return { agentId, results: await ingestEvents(db, agent, [body]) };
      if (pathName === "/api/v1/agent/inbox") return { agentId, ...(await inbox(db, agent)) };
      throw new Error(`unrouted ${pathName}`);
    } catch (e) {
      if (e instanceof HttpError) throw Object.assign(new Error(`Tend ${e.status} ${e.code}`), { status: e.status, code: e.code, body: { error: e.code, ...e.extra } });
      throw e;
    }
  };
}

async function setup({ enforcement = "enforce" } = {}) {
  const db = await memoryDb();
  const { agent } = await registerAgent(db, { name: "Notes clerk", model: "scripted", provider: "Anthropic" });
  await setPolicy(db, agent.id, POLICY, enforcement);
  const root = mkdtempSync(path.join(tmpdir(), "tend-notes-enf-"));
  const dir = path.join(root, "notes");
  mkdirSync(dir);
  for (const [name, text] of Object.entries(SEED)) writeFileSync(path.join(dir, `${name}.txt`), `${text}\n`);
  process.env.TEND_GATEWAY_NOTES_DIR = dir;
  const calls = [];
  return {
    db, agent, dir, root, calls, tend: localTend(db, agent.id, calls), files: () => readdirSync(dir).sort(),
    count: (sql, ...p) => db.get(sql, ...p).then((r) => r.n),
  };
}

async function close(s) {
  delete process.env.TEND_GATEWAY_NOTES_DIR;
  rmSync(s.root, { recursive: true, force: true });
  await s.db.close();
}

const UNTOUCHED = ["garden.txt", "printer.txt", "standup.txt"];
const modelOf = (...calls) => async (messages) => {
  const turn = messages.filter((m) => m.role === "assistant").length;
  if (turn >= calls.length) return { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] };
  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `tu_${turn}`, name: calls[turn][0], input: calls[turn][1] }] };
};
const statusOf = (s, id) => s.db.get("SELECT status FROM authorizations WHERE id = ?", id).then((r) => r?.status);

test("the model can use exactly the three gateway notes tools and nothing else", () => {
  assert.deepEqual(NOTES_TOOLS.map((t) => t.name), ["list_notes", "read_note", "write_note"]);
});

test("isolation preflight: gateway credentials and Tend server secrets in the agent's environment are refused, by name only", () => {
  for (const k of ["TEND_GATEWAY_NOTES_DIR", "TEND_GATEWAY_PAYMENTS_KEY", "TEND_ADMIN_TOKEN", "TEND_DATA_DIR", "DATABASE_URL", "POSTGRES_URL"]) {
    const secret = `secret-value-${k}`;
    assert.throws(() => assertNoDirectAccess({ PATH: "/bin", [k]: secret }), (e) => e instanceof IsolationError && e.code === "direct_access" && e.message.includes(k) && !e.message.includes(secret));
  }
  assertNoDirectAccess({ PATH: "/bin", TEND_URL: "http://x", TEND_AGENT_KEY: "tend_sk_x", ANTHROPIC_API_KEY: "k", TEND_GATEWAY_NOTES_DIR: "" });
});

test("a run whose environment holds a gateway credential is refused before Tend is contacted", async () => {
  const s = await setup();
  try {
    await assert.rejects(runNotesAgent({ model: modelOf(), tend: s.tend, env: { TEND_GATEWAY_NOTES_DIR: s.dir } }), (e) => e.code === "direct_access");
    assert.deepEqual(s.calls, []);
    assert.deepEqual(s.files(), UNTOUCHED);
  } finally {
    await close(s);
  }
});

test("a run is refused unless Tend has the agent in enforce mode; nothing is requested or recorded", async () => {
  const s = await setup({ enforcement: "monitor" });
  try {
    await assert.rejects(runNotesAgent({ model: modelOf(["write_note", { name: "x", text: "y" }]), tend: s.tend, env: {} }), (e) => e.code === "not_enforced");
    assert.deepEqual(s.calls, ["/api/v1/agent/inbox"]);
    assert.equal(await s.count("SELECT COUNT(*)::int AS n FROM authorizations"), 0);
    assert.equal(await s.count("SELECT COUNT(*)::int AS n FROM events WHERE type LIKE 'task.%'"), 0);
    assert.deepEqual(s.files(), UNTOUCHED);
  } finally {
    await close(s);
  }
});

test("tools outside the gateway and path escapes never run and never reach a file", async () => {
  const s = await setup();
  try {
    const out = await runNotesAgent({
      model: modelOf(["bash", { command: "rm -rf /" }], ["delete_note", { name: "standup" }], ["write_note", { name: "../escape", text: "x" }], ["read_note", { name: "standup", path: "/etc/passwd" }]),
      tend: s.tend, pollMs: 5, approvalTimeoutMs: 200, env: {},
    });
    assert.ok(out.calls.every((c) => c.executed === false));
    assert.deepEqual(out.calls.map((c) => c.reason), ["unknown_tool", "unknown_tool", "invalid_params", "invalid_params"]);
    assert.equal(await s.count("SELECT COUNT(*)::int AS n FROM authorizations"), 0);
    assert.equal(existsSync(path.join(s.root, "escape.txt")), false);
    assert.deepEqual(s.files(), UNTOUCHED);
  } finally {
    await close(s);
  }
});

test("pending: nothing executes before approval, a forged token is refused, and giving up cancels the request", async () => {
  const s = await setup();
  try {
    let during;
    const out = await runNotesAgent({
      model: modelOf(["write_note", { name: "late", text: "must not exist" }]),
      tend: s.tend, pollMs: 5, approvalTimeoutMs: 150, env: {},
      onPending: async ({ authorizationId }) => {
        const claim = await s.tend(`/api/v1/authorizations/${authorizationId}/token`, {});
        const forged = await s.tend("/api/v1/gateway/execute", { authorizationId, token: FORGED, tool: "write_note", params: { name: "late", text: "must not exist" } }).catch((e) => e);
        during = { claim, forged, id: authorizationId };
      },
    });
    assert.equal(during.claim.status, "pending");
    assert.equal(during.claim.token, undefined);
    assert.equal(during.forged.status, 403);
    assert.deepEqual([out.calls[0].executed, out.calls[0].outcome], [false, "timeout"]);
    assert.equal(await statusOf(s, during.id), "cancelled");
    assert.equal(existsSync(path.join(s.dir, "late.txt")), false);
  } finally {
    await close(s);
  }
});

test("rejected: no token can be issued or used afterwards, and the file is never written", async () => {
  const s = await setup();
  try {
    let id;
    const out = await runNotesAgent({
      model: modelOf(["write_note", { name: "nope", text: "rejected text" }]),
      tend: s.tend, pollMs: 5, approvalTimeoutMs: 2_000, env: {},
      onPending: async ({ authorizationId }) => {
        id = authorizationId;
        await decide(s.db, authorizationId, "rejected");
      },
    });
    assert.deepEqual([out.calls[0].executed, out.calls[0].outcome], [false, "rejected"]);
    assert.equal((await s.tend(`/api/v1/authorizations/${id}/token`, {}).catch((e) => e)).status, 403);
    const forged = await s.tend("/api/v1/gateway/execute", { authorizationId: id, token: FORGED, tool: "write_note", params: { name: "nope", text: "rejected text" } }).catch((e) => e);
    assert.equal(forged.status, 403);
    assert.equal(await statusOf(s, id), "rejected");
    assert.equal(existsSync(path.join(s.dir, "nope.txt")), false);
  } finally {
    await close(s);
  }
});

test("approved: the write happens once; a replay, a second claim and five parallel attempts add nothing", async () => {
  const s = await setup();
  try {
    const params = { name: "once", text: "written exactly once" };
    const req = await s.tend("/api/v1/gateway/requests", { tool: "write_note", params });
    assert.equal(req.status, "pending");
    assert.equal(existsSync(path.join(s.dir, "once.txt")), false);
    await decide(s.db, req.id, "approved");
    const { token } = await s.tend(`/api/v1/authorizations/${req.id}/token`, {});
    const body = { authorizationId: req.id, token, tool: "write_note", params };
    const ran = await s.tend("/api/v1/gateway/execute", body);
    assert.equal(ran.executed, true);
    assert.equal(readFileSync(path.join(s.dir, "once.txt"), "utf8"), "written exactly once\n");
    assert.equal((await s.tend("/api/v1/gateway/execute", body).catch((e) => e)).code, "already_consumed");
    assert.equal((await s.tend(`/api/v1/authorizations/${req.id}/token`, {}).catch((e) => e)).status, 403);
    assert.equal(await s.count("SELECT COUNT(*)::int AS n FROM events WHERE type = 'authorization.consumed'"), 1);
    assert.equal(await s.count(`SELECT COUNT(*)::int AS n FROM events WHERE type = 'tool.called' AND (data::jsonb)->>'outcome' = 'success'`), 1);

    const race = await s.tend("/api/v1/gateway/requests", { tool: "write_note", params: { name: "race", text: "one winner" } });
    await decide(s.db, race.id, "approved");
    const t2 = (await s.tend(`/api/v1/authorizations/${race.id}/token`, {})).token;
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => s.tend("/api/v1/gateway/execute", { authorizationId: race.id, token: t2, tool: "write_note", params: { name: "race", text: "one winner" } })));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(readFileSync(path.join(s.dir, "race.txt"), "utf8"), "one winner\n");
  } finally {
    await close(s);
  }
});

test("an approval for one tool or text cannot be spent on another", async () => {
  const s = await setup();
  try {
    const req = await s.tend("/api/v1/gateway/requests", { tool: "read_note", params: { name: "standup" } });
    await decide(s.db, req.id, "approved");
    const { token } = await s.tend(`/api/v1/authorizations/${req.id}/token`, {});
    const swapped = await s.tend("/api/v1/gateway/execute", { authorizationId: req.id, token, tool: "write_note", params: { name: "evil", text: "swapped" } }).catch((e) => e);
    assert.equal(swapped.status, 403);
    assert.equal(existsSync(path.join(s.dir, "evil.txt")), false);
  } finally {
    await close(s);
  }
});

test("if Tend cannot be reached at execution the agent does not fall back to acting itself", async () => {
  const s = await setup();
  try {
    const down = (p, b, h) => (p === "/api/v1/gateway/execute" ? Promise.reject(new Error("ECONNRESET")) : s.tend(p, b, h));
    const out = await runNotesAgent({
      model: modelOf(["write_note", { name: "offline", text: "no fallback" }]),
      tend: down, pollMs: 5, approvalTimeoutMs: 2_000, env: {},
      onPending: ({ authorizationId }) => decide(s.db, authorizationId, "approved"),
    });
    assert.deepEqual([out.calls[0].executed, out.calls[0].outcome], [false, "unavailable"]);
    assert.equal(existsSync(path.join(s.dir, "offline.txt")), false);
  } finally {
    await close(s);
  }
});

test("neither the notes directory nor any credential reaches the model", async () => {
  const s = await setup();
  try {
    const seen = [];
    const scripted = scriptedNotesModel();
    const out = await runNotesAgent({
      model: async (messages) => (seen.push(JSON.stringify(messages)), scripted(messages)),
      tend: s.tend, pollMs: 5, approvalTimeoutMs: 2_000, env: {},
      onPending: ({ authorizationId }) => decide(s.db, authorizationId, "approved"),
    });
    assert.ok(out.calls.every((c) => c.executed));
    const all = seen.join("\n");
    assert.equal(all.includes(s.dir), false);
    assert.equal(all.includes(path.basename(s.root)), false);
    assert.equal(/TEND_GATEWAY|tend_az_|tend_sk_/.test(all), false);
  } finally {
    await close(s);
  }
});
