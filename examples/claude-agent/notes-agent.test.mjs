// Isolated notes agent: in-memory Tend + a temp notes directory. The model is scripted (no API cost).
// Every file operation goes through the real gateway. The agent module does not import `fs`.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cancelAuthorization, claimToken, consumeAuthorization } from "../../src/server/authz.ts";
import { memoryDb } from "../../src/server/db.ts";
import { executeTool, requestExecution } from "../../src/server/gateway.ts";
import { HttpError } from "../../src/server/http.ts";
import { decide, getAgent, inbox, ingestEvents, registerAgent, setPolicy } from "../../src/server/repo.ts";
import { createGateway } from "./gateway-client.mjs";
import { NOTES_PLAN, runNotesAgent, scriptedNotesModel } from "./notes-agent.mjs";

const POLICY = [
  { tool: "list_notes", action: "list", effect: "approve" },
  { tool: "read_note", action: "read", effect: "approve" },
  { tool: "write_note", action: "create", effect: "approve" },
];

const SEED = {
  standup: "FICTIONAL standup: Anna owns the Q4 plan.",
  printer: "FICTIONAL errand: order printer paper on Monday.",
  garden: "FICTIONAL idea: plant herbs by the north wall.",
};

function seedDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "tend-notes-agent-"));
  for (const [name, text] of Object.entries(SEED)) writeFileSync(path.join(dir, `${name}.txt`), `${text}\n`);
  return dir;
}

function localTend(db, agentId) {
  return async (pathName, body, headers = {}) => {
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
      if (e instanceof HttpError) throw Object.assign(new Error(`Tend ${e.status} ${e.code}: ${e.message}`), { status: e.status, code: e.code, body: { error: e.code, message: e.message, ...e.extra } });
      throw e;
    }
  };
}

async function setup(policy = POLICY) {
  const db = await memoryDb();
  const { agent } = await registerAgent(db, { name: "Notes clerk", model: "scripted", provider: "Anthropic" });
  if (policy) await setPolicy(db, agent.id, policy, "enforce");
  const dir = seedDir();
  process.env.TEND_GATEWAY_NOTES_DIR = dir;
  return { db, agent, dir, tend: localTend(db, agent.id), files: () => readdirSync(dir).sort() };
}

async function close(s) {
  delete process.env.TEND_GATEWAY_NOTES_DIR;
  rmSync(s.dir, { recursive: true, force: true });
  await s.db.close();
}

test("the notes agent module has no filesystem access of its own", async () => {
  const src = readFileSync(new URL("./notes-agent.mjs", import.meta.url), "utf8") + readFileSync(new URL("./gateway-client.mjs", import.meta.url), "utf8");
  assert.equal(/from ["']node:fs/.test(src), false);
  assert.equal(/require\(["']fs/.test(src), false);
});

test("no policy: the model's call is denied and the notes directory is untouched", async () => {
  const s = await setup(null);
  try {
    const gw = createGateway({ tend: s.tend, pollMs: 5, retryMs: 0, approvalTimeoutMs: 200 });
    const out = await gw.run("list_notes", {});
    assert.deepEqual([out.executed, out.outcome], [false, "denied"]);
    assert.deepEqual(s.files(), ["garden.txt", "printer.txt", "standup.txt"]);
  } finally {
    await close(s);
  }
});

test("rejecting an action prevents execution; changing params is blocked; replay fails", async () => {
  const s = await setup();
  try {
    const gw = createGateway({
      tend: s.tend, pollMs: 5, retryMs: 0, approvalTimeoutMs: 2_000,
      onPending: (p) => decide(s.db, p.authorizationId, "rejected"),
    });
    const rejected = await gw.run("write_note", { name: "inbox-summary", text: "should not be written" });
    assert.deepEqual([rejected.executed, rejected.outcome], [false, "rejected"]);
    assert.equal(s.files().includes("inbox-summary.txt"), false);

    const req = await s.tend("/api/v1/gateway/requests", { tool: "read_note", params: { name: "standup" } });
    await decide(s.db, req.id, "approved");
    const claimed = await s.tend(`/api/v1/authorizations/${req.id}/token`, {});
    const mismatch = await s.tend("/api/v1/gateway/execute", { authorizationId: req.id, token: claimed.token, tool: "read_note", params: { name: "garden" } }).catch((e) => e);
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.code, "mismatch");
    assert.deepEqual(s.files(), ["garden.txt", "printer.txt", "standup.txt"]);

    const ok = await s.tend("/api/v1/gateway/execute", { authorizationId: req.id, token: claimed.token, tool: "read_note", params: { name: "standup" } });
    assert.equal(ok.executed, true);
    const replay = await s.tend("/api/v1/gateway/execute", { authorizationId: req.id, token: claimed.token, tool: "read_note", params: { name: "standup" } }).catch((e) => e);
    assert.equal(replay.status, 409);
    assert.equal(replay.code, "already_consumed");
  } finally {
    await close(s);
  }
});

test("scripted organize-notes: after each human approval the agent continues and writes inbox-summary", async () => {
  const s = await setup();
  try {
    const { calls } = await runNotesAgent({
      model: scriptedNotesModel(),
      tend: s.tend,
      pollMs: 5,
      approvalTimeoutMs: 2_000,
      source: "scripted",
      onPending: ({ authorizationId }) => decide(s.db, authorizationId, "approved"),
    });
    assert.equal(calls.length, NOTES_PLAN.flat().length);
    assert.ok(calls.every((c) => c.executed && c.outcome === "success"));
    assert.deepEqual(calls.map((c) => c.tool), ["list_notes", "read_note", "read_note", "read_note", "write_note"]);
    assert.equal(readFileSync(path.join(s.dir, "inbox-summary.txt"), "utf8").includes("Anna owns Q4"), true);
    assert.equal(readFileSync(path.join(s.dir, "standup.txt"), "utf8"), `${SEED.standup}\n`);
  } finally {
    await close(s);
  }
});
