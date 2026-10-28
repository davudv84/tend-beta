// Tests of Verified Protection, including tests of the verifier itself: each protection is switched off in an isolated copy and
// the matching check must turn At Risk, never Verified. Also: it never touches real data, it fails closed, and it never claims
// more than one stated check. In-memory Postgres (PGlite); the real-PostgreSQL parts are in postgres.test.ts.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ALL_CHECKS, outOfDate, type CheckId, type CheckResult, type VerificationRun } from "../lib/verification.ts";
import { claimToken } from "./authz.ts";
import { memoryDb, type DB } from "./db.ts";
import { executeTool, requestExecution } from "./gateway.ts";
import { HttpError } from "./http.ts";
import { control, decide, getAgent, insertEvent, registerAgent, setPolicy } from "./repo.ts";
import { latestVerification, readOnly, runVerification } from "./verification.ts";
import { alertIfOutside, everOutside, folderClosed, historyApproved, historyOnce } from "./verification-live.ts";
import { realApi, runIsolatedChecks, type GatewayApi } from "./verification-sandbox.ts";

const SID = "0123456789abcdef";
const RULES = [
  { tool: "list_notes", action: "list", effect: "allow" },
  { tool: "read_note", action: "read", effect: "allow" },
  { tool: "write_note", action: "create", effect: "approve" },
];
const FORGED_PREFIX = "tend_az_AAAA";
const byId = (checks: CheckResult[]) => Object.fromEntries(checks.map((c) => [c.id, c])) as Record<CheckId, CheckResult>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A connected agent in a real (in-memory) Tend, with a "real" notes folder holding data that must never be touched. */
async function realTend(opts: { rules?: object[]; enforcement?: "monitor" | "enforce"; mode?: number } = {}) {
  const db = await memoryDb();
  const { agent } = await registerAgent(db, { name: "Real Notes Agent", model: "m", provider: "Anthropic" }, SID);
  await setPolicy(db, agent.id, opts.rules ?? RULES, opts.enforcement ?? "enforce", SID);
  const dir = mkdtempSync(path.join(tmpdir(), "tend-real-notes-"));
  writeFileSync(path.join(dir, "real-secret-note.txt"), "REAL CUSTOMER DATA: do not touch.\n");
  chmodSync(dir, opts.mode ?? 0o700);
  const previous = process.env.TEND_GATEWAY_NOTES_DIR;
  process.env.TEND_GATEWAY_NOTES_DIR = dir;
  return {
    db, id: agent.id, dir,
    done: async () => {
      chmodSync(dir, 0o700);
      if (previous === undefined) delete process.env.TEND_GATEWAY_NOTES_DIR;
      else process.env.TEND_GATEWAY_NOTES_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
      await db.close();
    },
  };
}
type RealTend = Awaited<ReturnType<typeof realTend>>;

/** One genuinely approved write in the real Tend, so there is history to look at. */
async function approvedWrite(r: RealTend) {
  const agent = (await getAgent(r.db, r.id))!;
  const params = { name: "real-written", text: "written through Tend" };
  const { view } = await requestExecution(r.db, agent, { tool: "write_note", params }, null);
  await decide(r.db, view.id, "approved", undefined, SID);
  const { view: pass } = await claimToken(r.db, agent, view.id);
  if (!("token" in pass)) throw new Error("no pass");
  await executeTool(r.db, agent, { authorizationId: view.id, token: pass.token, tool: "write_note", params });
  return view.id;
}

const hashFolder = (dir: string) => readdirSync(dir).sort().map((f) => `${f}:${readFileSync(path.join(dir, f), "utf8")}`).join("|");
const tables = ["agents", "events", "reviews", "authorizations", "asks", "meta", "verification_runs"];
const rowCounts = async (db: DB) => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, (await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${t}`))!.n])));

// ---- a full run -------------------------------------------------------------------------------------------------------

test("a full run on a typical notes agent: each check's status, the hard rules, and the stored evidence", async () => {
  const r = await realTend();
  try {
    await approvedWrite(r);
    const run = await runVerification(r.db, r.id, SID, { notesDir: r.dir });
    const c = byId(run.checks);

    assert.deepEqual(run.checks.map((x) => [x.id, x.group]), ALL_CHECKS.map((x) => [x.id, x.group]), "all eleven checks, in order");
    assert.equal(c.folder_closed.status, "verified");
    assert.equal(c.alert_if_outside.status, "verified");
    assert.equal(c.history_approved.status, "verified");
    assert.deepEqual(c.history_approved.facts, { checked: 1, ranWithoutAsking: 0 });
    assert.equal(c.history_once.status, "verified");
    for (const id of ["forbidden_refused", "malformed_refused", "ask_first_holds", "rejection_holds", "approval_once"] as const) assert.equal(c[id].status, "verified", id);
    assert.deepEqual(c.forbidden_refused.facts.tested, ["pay_invoice", "test_ping", "read_test_file", "write_test_file", "delete_test_file"]);
    assert.deepEqual(c.ask_first_holds.facts.tested, ["write_note"]);
    assert.deepEqual(run.runsWithoutAsking, ["list_notes", "read_note"]);

    // The hard rules: an empty record is not proof, and Tend cannot see where the agent runs.
    assert.deepEqual([c.ever_outside.status, c.ever_outside.why], ["not_verified", "nothing_reported"]);
    assert.deepEqual([c.agent_isolated.status, c.agent_isolated.why], ["not_verified", "cannot_be_checked"]);
    for (const x of run.checks) assert.ok(["verified", "at_risk", "not_verified"].includes(x.status));
    assert.equal(Object.keys(run).some((k) => /score|grade|rating|overall|protected/i.test(k)), false, "no total of any kind");

    // Stored as evidence, with an audit event that carries only counts.
    assert.deepEqual(await latestVerification(r.db, r.id), JSON.parse(JSON.stringify(run)));
    const ev = (await r.db.all<{ data: string }>("SELECT data FROM events WHERE type = 'verification.run'")).map((e) => JSON.parse(e.data));
    assert.deepEqual(ev, [{ runId: run.id, verified: 9, atRisk: 0, notVerified: 2, by: SID }]);
    assert.equal(await sqlState(() => r.db.run("UPDATE verification_runs SET results = '{}'")), "42501", "results are evidence: append-only");
    assert.equal(await sqlState(() => r.db.run("DELETE FROM verification_runs")), "42501");

    // And it goes out of date when the settings change.
    assert.equal(outOfDate(run, (await getAgent(r.db, r.id))!), false);
    await control(r.db, r.id, "pause");
    assert.equal(outOfDate(run, (await getAgent(r.db, r.id))!), true);
  } finally {
    await r.done();
  }
});
const sqlState = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return "ok";
};

test("with no rules at all, nothing is Verified by default: there is simply nothing to try", async () => {
  const r = await realTend({ rules: [] });
  try {
    const c = byId((await runVerification(r.db, r.id, SID, { notesDir: r.dir })).checks);
    assert.deepEqual([c.forbidden_refused.status, (c.forbidden_refused.facts.tested as string[]).length > 0], ["verified", true], "everything is forbidden, and every request is refused");
    for (const id of ["ask_first_holds", "rejection_holds", "approval_once"] as const) assert.equal(c[id].status, "not_verified", id);
    assert.equal(c.approval_once.why, "nothing_allowed");
  } finally {
    await r.done();
  }
});

// ---- live checks ------------------------------------------------------------------------------------------------------

test("live checks: the folder, the enforcement setting and every kind of Not Verified", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tend-folder-"));
  const file = path.join(dir, "a-file");
  writeFileSync(file, "x");
  try {
    chmodSync(dir, 0o700);
    assert.deepEqual([(await folderClosed(dir)).status, (await folderClosed(dir)).facts], ["verified", { mode: "0700" }]);
    chmodSync(dir, 0o750);
    assert.deepEqual([(await folderClosed(dir)).status, (await folderClosed(dir)).why], ["at_risk", "open_to_others"]);
    chmodSync(dir, 0o707);
    assert.equal((await folderClosed(dir)).status, "at_risk", "any access for others counts");
    chmodSync(dir, 0o700);
    const link = path.join(tmpdir(), `tend-link-${Date.now()}`);
    symlinkSync(dir, link);
    for (const [target, why] of [[undefined, "not_configured"], ["relative/path", "not_configured"], [link, "is_link"], [file, "not_a_folder"], [path.join(dir, "missing"), "cannot_inspect"]] as const)
      assert.deepEqual([(await folderClosed(target)).status, (await folderClosed(target)).why], ["not_verified", why], String(why));
    rmSync(link);
    assert.equal(alertIfOutside("enforce").status, "verified");
    assert.deepEqual([alertIfOutside("monitor").status, alertIfOutside("monitor").why], ["at_risk", "monitor_only"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("live checks read the record skeptically: a missing approval, a doubly used approval and an outside report are At Risk; an empty record is not Verified", async () => {
  const mk = async () => realTend();
  const empty = await mk();
  const tampered = await mk();
  try {
    const ro = readOnly(empty.db);
    assert.deepEqual([(await historyApproved(ro, empty.id)).why, (await historyOnce(ro, empty.id)).why, (await everOutside(ro, empty.id)).why], ["no_history", "no_history", "nothing_reported"]);

    const id = await approvedWrite(tampered);
    const ro2 = readOnly(tampered.db);
    assert.equal((await historyApproved(ro2, tampered.id)).status, "verified");
    assert.equal((await historyOnce(ro2, tampered.id)).status, "verified");

    // 1. An authorization that needed approval and was used, with no approval on record.
    await tampered.db.run(
      `INSERT INTO authorizations (id, agent_id, tool, action, fingerprint, status, reason, created_at, expires_at, consumed_at) VALUES ('az_tampered', ?, 'write_note', 'create', 'f', 'consumed', 'approval_required', 1, 2, 3)`, tampered.id);
    const missing = await historyApproved(ro2, tampered.id);
    assert.deepEqual([missing.status, missing.why, missing.facts], ["at_risk", "missing_approval", { checked: 2, missing: 1 }]);

    // 2. The same approval recorded as used twice.
    await tampered.db.tx((q) => insertEvent(q, { agentId: tampered.id, type: "authorization.consumed", actor: "system", data: { authorizationId: id } }));
    const twice = await historyOnce(ro2, tampered.id);
    assert.deepEqual([twice.status, twice.why, twice.facts.usedTwice], ["at_risk", "used_twice", 1]);

    // 3. A report that an action ran outside Tend. And a refused replay does not count: it was blocked.
    await tampered.db.tx((q) => insertEvent(q, { agentId: tampered.id, type: "alert.raised", actor: "system", data: { kind: "authorization_replay", reason: "replay" } }));
    assert.equal((await everOutside(ro2, tampered.id)).status, "not_verified", "a refused replay is the protection working");
    await tampered.db.tx((q) => insertEvent(q, { agentId: tampered.id, type: "alert.raised", actor: "system", data: { kind: "unauthorized_execution", reason: "no_authorization" } }));
    const outside = await everOutside(ro2, tampered.id);
    assert.deepEqual([outside.status, outside.why, outside.facts.reports], ["at_risk", "reported", 1]);

    // Everything an approver never needed to approve is not a pass either.
    const auto = await realTend({ rules: [{ tool: "list_notes", action: "list", effect: "allow" }] });
    try {
      const a = (await getAgent(auto.db, auto.id))!;
      const { view } = await requestExecution(auto.db, a, { tool: "list_notes", params: {} }, null);
      const { view: pass } = await claimToken(auto.db, a, view.id);
      if (!("token" in pass)) throw new Error("no pass");
      await executeTool(auto.db, a, { authorizationId: view.id, token: pass.token, tool: "list_notes", params: {} });
      const none = await historyApproved(readOnly(auto.db), auto.id);
      assert.deepEqual([none.status, none.why, none.facts], ["not_verified", "nothing_needed_approval", { checked: 1, ranWithoutAsking: 1 }]);
    } finally {
      await auto.done();
    }
  } finally {
    await empty.done();
    await tampered.done();
  }
});

// ---- fail closed ------------------------------------------------------------------------------------------------------

test("fail closed: unreadable rules, a timeout, a crashing probe, a demo agent, an unknown agent and overlapping runs never produce Verified", async () => {
  const r = await realTend();
  try {
    // Rules that cannot be read.
    await r.db.run("UPDATE agents SET policy = 'not json' WHERE id = ?", r.id);
    const broken = await runVerification(r.db, r.id, SID, { notesDir: r.dir });
    assert.ok(broken.checks.filter((c) => c.group === "isolated").every((c) => c.status === "not_verified" && c.why === "rules_unreadable"));
    await r.db.run("UPDATE agents SET policy = ? WHERE id = ?", JSON.stringify(RULES), r.id);

    // A timeout: the checks that did not finish are Not Verified, not assumed fine.
    const slow = await runVerification(r.db, r.id, SID, { notesDir: r.dir, sandboxTimeoutMs: 1 });
    assert.ok(slow.checks.filter((c) => c.group === "isolated").every((c) => c.status === "not_verified" && c.why === "timed_out"));
    await sleep(2500); // let the abandoned private copy finish and clean up

    // A probe that crashes (not a refusal) says nothing.
    const crashing: GatewayApi = { ...realApi, executeTool: async () => { throw new Error("boom"); } };
    const crashed = byId((await runVerification(r.db, r.id, SID, { notesDir: r.dir, api: crashing })).checks);
    for (const id of ["forbidden_refused", "ask_first_holds", "rejection_holds", "approval_once"] as const) assert.deepEqual([crashed[id].status, crashed[id].why], ["not_verified", "could_not_run"], id);

    // A refusal for the wrong reason (a 5xx, a tool that isn't set up) is not a refusal either.
    const notSetUp: GatewayApi = { ...realApi, executeTool: async () => { throw new HttpError(503, "tool_unavailable", "x"); } };
    assert.equal(byId((await runVerification(r.db, r.id, SID, { notesDir: r.dir, api: notSetUp })).checks).forbidden_refused.status, "not_verified");

    // Who can be checked, and one run at a time.
    const demo = await realTend();
    await demo.db.run("UPDATE agents SET origin = 'demo' WHERE id = ?", demo.id);
    await assert.rejects(runVerification(demo.db, demo.id), (e) => e instanceof HttpError && e.code === "verification_unavailable");
    await demo.done();
    await assert.rejects(runVerification(r.db, "nobody"), (e) => e instanceof HttpError && e.status === 404);
    const first = runVerification(r.db, r.id, SID, { notesDir: r.dir });
    await assert.rejects(runVerification(r.db, r.id, SID, { notesDir: r.dir }), (e) => e instanceof HttpError && e.code === "verification_running");
    await first;
  } finally {
    await r.done();
  }
});

// ---- it never touches real data ---------------------------------------------------------------------------------------

test("never touches real data: the database refuses writes in its read-only transaction, the filter refuses side effects, and nothing real changes", async () => {
  const r = await realTend();
  try {
    await approvedWrite(r);
    // The database itself holds the checks' transaction read-only, so even a statement that slipped past the filter would fail.
    await assert.rejects(r.db.tx(async (q) => { await q.run("SET TRANSACTION READ ONLY"); await q.run("INSERT INTO meta (key, value) VALUES ('x', 'y')"); }), /read-only/i);
    await assert.rejects(r.db.tx(async (q) => { await q.run("SET TRANSACTION READ ONLY"); await q.run("UPDATE agents SET status = 'paused'"); }), /read-only/i);
    // The filter: plain reads pass, everything else is refused before it reaches the database.
    const ro = readOnly(r.db);
    assert.ok(Array.isArray(await ro.all("SELECT 1 AS one")));
    for (const sql of ["INSERT INTO meta (key, value) VALUES ('a','b')", "UPDATE agents SET status = 'paused'", "DELETE FROM events", "SELECT set_config('tend.maintenance', 'on', true)",
      "WITH gone AS (DELETE FROM reviews RETURNING 1) SELECT * FROM gone", "SELECT pg_advisory_xact_lock(1)", "TRUNCATE events", "DROP TABLE events"])
      await assert.rejects(ro.all(sql), /read-only/, sql);
    await assert.rejects(ro.run("SELECT 1"), /read-only/);
    await assert.rejects(ro.exec("SELECT 1"), /read-only/);
    await assert.rejects(ro.lockEvents(), /read-only/);

    // A full run changes exactly two records of its own and nothing else.
    const before = await rowCounts(r.db), folder = hashFolder(r.dir);
    await runVerification(r.db, r.id, SID, { notesDir: r.dir });
    const after = await rowCounts(r.db);
    assert.deepEqual({ ...after, events: after.events - 1, verification_runs: after.verification_runs - 1 }, before, "only its own result row and its audit event were added");
    assert.equal(hashFolder(r.dir), folder, "the real notes folder is unchanged");
    const agent = (await getAgent(r.db, r.id))!;
    assert.deepEqual([agent.configVersion, agent.status], [(await getAgent(r.db, r.id))!.configVersion, "active"]);
  } finally {
    await r.done();
  }
});

test("never opens the real folder: it works with a folder it may not list, and leaves permissions as they were", async () => {
  const r = await realTend({ mode: 0o300 }); // owner may write and enter, not list or read
  try {
    const run = await runVerification(r.db, r.id, SID, { notesDir: r.dir });
    assert.deepEqual([byId(run.checks).folder_closed.status, byId(run.checks).folder_closed.facts], ["verified", { mode: "0300" }], "the answer came from permissions alone");
    chmodSync(r.dir, 0o700);
    assert.equal(hashFolder(r.dir), "real-secret-note.txt:REAL CUSTOMER DATA: do not touch.\n");
  } finally {
    await r.done();
  }
});

test("real requests are unaffected while the checks run: the private copy changes nothing shared", async () => {
  const r = await realTend();
  try {
    const agent = (await getAgent(r.db, r.id))!;
    const seen = new Set<string>(), envSeen = new Set<string | undefined>();
    let running = true;
    const real = (async () => {
      let n = 0;
      while (running) {
        const { view } = await requestExecution(r.db, agent, { tool: "list_notes", params: {} }, null);
        const { view: pass } = await claimToken(r.db, agent, view.id);
        if (!("token" in pass)) throw new Error("no pass");
        const out = await executeTool(r.db, agent, { authorizationId: view.id, token: pass.token, tool: "list_notes", params: {} });
        seen.add(String((out.result as { names: string }).names));
        envSeen.add(process.env.TEND_GATEWAY_NOTES_DIR);
        n++;
      }
      return n;
    })();
    const run = await runVerification(r.db, r.id, SID, { notesDir: r.dir });
    running = false;
    const n = await real;
    assert.ok(n >= 3, `only ${n} real requests overlapped the run`);
    assert.deepEqual([...seen], ["real-secret-note"], "every real request saw the real folder, never the private copy's invented notes");
    assert.deepEqual([...envSeen], [r.dir], "the shared environment was never changed");
    assert.equal(process.env.TEND_GATEWAY_NOTES_DIR, r.dir);
    assert.ok(run.checks.filter((c) => c.group === "isolated").every((c) => c.status === "verified"));
  } finally {
    await r.done();
  }
});

test("results never contain a path, a key, a token, a note's name or text", async () => {
  const r = await realTend();
  try {
    await approvedWrite(r);
    const run = await runVerification(r.db, r.id, SID, { notesDir: r.dir });
    const text = JSON.stringify(run);
    for (const secret of [r.dir, path.basename(r.dir), "tend-verify-", "real-secret-note", "REAL CUSTOMER", "real-written", "written through Tend", "invented", "verify-probe"])
      assert.equal(text.includes(secret), false, `the result contains "${secret}"`);
    assert.equal(/tend_sk_|tend_az_|verify_[0-9a-f]{36}|\/var\/|\/private\/|\/tmp\/|\/Users\//.test(text), false, "a key, token or path");
  } finally {
    await r.done();
  }
});

test("by construction: the live module can only look, and the private copy is given nothing real", () => {
  const src = (f: string) => readFileSync(path.join(import.meta.dirname, f), "utf8");
  const live = src("verification-live.ts"), sandbox = src("verification-sandbox.ts"), orchestrator = src("verification.ts");
  assert.deepEqual([...live.matchAll(/from "(node:[^"]+)"/g)].map((m) => m[1]).sort(), ["node:fs/promises", "node:path"]);
  assert.match(live, /import \{ lstat \} from "node:fs\/promises"/);
  assert.equal(/readdir|readFile|writeFile|appendFile|opendir|createReadStream|unlink|mkdir|rename|chmod|\brm\(|\bdetail\b/.test(live), false, "the live module must not read, write or select note content");
  assert.equal(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/.test(live), false, "no write statements in the live module");
  assert.equal(/getDb|process\.env|DATABASE_URL|config\.ts/.test(sandbox), false, "the private copy must never reach the real database or environment");
  assert.match(orchestrator, /runIsolatedChecks\(\{ rules: parsed\.rules \}/, "only the rules go into the private copy");
});

// ---- the verifier itself: deliberately broken gateways ----------------------------------------------------------------

const rules = RULES as never;
const FAKE_OK = { executed: true, authorizationId: "x", tool: "x", action: "x", result: {} } as never;
const fakeView = (status: string) => ({ view: { id: "az_fake", status, tool: "x", action: "x", resource: null, detail: null, createdAt: 0, expiresAt: 0 }, created: true }) as never;

/** A gateway with one protection switched off. `real` is the genuine call, for everything the break doesn't touch. */
const broken = (make: (real: GatewayApi, memo: Map<string, { params: unknown; agent: unknown }>) => Partial<GatewayApi>): GatewayApi => {
  const memo = new Map<string, { params: unknown; agent: unknown }>();
  return { ...realApi, ...make(realApi, memo) };
};
const refuseOnly = async (fn: () => Promise<unknown>, code: string) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError && e.code === code) return undefined;
    throw e;
  }
};

const BREAKS: { name: string; api: GatewayApi; check: CheckId; failed: string }[] = [
  { name: "a forbidden request is not denied", check: "forbidden_refused", failed: "request_denied",
    api: broken((real) => ({ requestExecution: async (...a) => { const r = await real.requestExecution(...a); return r.view.status === "denied" ? { ...r, view: { ...r.view, status: "pending" as never } } : r; } })) },
  { name: "a forged pass is accepted", check: "forbidden_refused", failed: "forged_pass_refused",
    api: broken((real) => ({ executeTool: async (db, agent, body, now) => ((body as { token?: string }).token?.startsWith(FORGED_PREFIX) ? FAKE_OK : real.executeTool(db, agent, body, now)) })) },
  { name: "a wrong pass is accepted on an approved request", check: "approval_once", failed: "wrong_pass_refused",
    api: broken((real) => ({ executeTool: async (db, agent, body, now) => ((body as { token?: string }).token?.startsWith(FORGED_PREFIX) ? FAKE_OK : real.executeTool(db, agent, body, now)) })) },
  { name: "a missing pass is accepted", check: "forbidden_refused", failed: "missing_pass_refused",
    api: broken((real) => ({ executeTool: async (db, agent, body, now) => ((body as { token?: string }).token === undefined ? FAKE_OK : real.executeTool(db, agent, body, now)) })) },
  { name: "a made-up action is accepted", check: "malformed_refused", failed: "unknown_action",
    api: broken((real) => ({ requestExecution: async (...a) => refuseOnly(() => real.requestExecution(...a), "unknown_tool").then((r) => r ?? fakeView("pending")) as never })) },
  { name: "a folder path or web address in a name is accepted", check: "malformed_refused", failed: "hidden_path_or_address",
    api: broken((real) => ({ requestExecution: async (...a) => refuseOnly(() => real.requestExecution(...a), "invalid_params").then((r) => r ?? fakeView("pending")) as never })) },
  { name: "a pass is handed out while the request is still waiting", check: "ask_first_holds", failed: "no_pass_before_decision",
    api: broken((real) => ({ claimToken: async (...a) => { const r = await real.claimToken(...a); return (r.view as { status: string }).status === "pending" ? ({ view: { ...r.view, token: "tend_az_x" } } as never) : r; } })) },
  { name: "a rejection is ignored", check: "rejection_holds", failed: "no_pass_after_rejection",
    api: broken((real) => ({ decide: async (db, id, status, ...rest) => real.decide(db, id, status === "rejected" ? "approved" : status, ...rest) })) },
  { name: "a second use is accepted", check: "approval_once", failed: "second_use_refused",
    api: broken((real) => { const used = new Set<string>(); return { executeTool: async (db, agent, body, now) => { const id = (body as { authorizationId: string }).authorizationId; if (used.has(id)) return FAKE_OK; const r = await real.executeTool(db, agent, body, now); used.add(id); return r; } }; }) },
  { name: "a changed request is accepted", check: "approval_once", failed: "changed_request_refused",
    api: broken((real, memo) => ({
      requestExecution: async (db, agent, body, idem, now) => { const r = await real.requestExecution(db, agent, body, idem, now); memo.set(r.view.id, { params: (body as { params: unknown }).params, agent }); return r; },
      executeTool: async (db, agent, body, now) => { const m = memo.get((body as { authorizationId: string }).authorizationId); return real.executeTool(db, agent, m ? { ...(body as object), params: m.params } : body, now); },
    })) },
  { name: "another agent can take the pass", check: "approval_once", failed: "other_agent_refused_pass",
    api: broken((real, memo) => ({
      requestExecution: async (db, agent, body, idem, now) => { const r = await real.requestExecution(db, agent, body, idem, now); memo.set(r.view.id, { params: null, agent }); return r; },
      claimToken: async (db, _agent, id, now) => real.claimToken(db, (memo.get(id)?.agent ?? _agent) as never, id, now),
    })) },
  { name: "an expired pass is accepted", check: "approval_once", failed: "expired_pass_refused",
    api: broken((real) => ({ executeTool: async (db, agent, body) => real.executeTool(db, agent, body) })) },
];

test("the verifier is not fooled: the unbroken gateway verifies everything it can", async () => {
  const c = byId(await runIsolatedChecks({ rules }));
  for (const id of ["forbidden_refused", "malformed_refused", "ask_first_holds", "rejection_holds", "approval_once"] as const) assert.equal(c[id].status, "verified", id);
});

for (const b of BREAKS)
  test(`the verifier notices a broken gateway: ${b.name}`, async () => {
    const c = byId(await runIsolatedChecks({ rules }, b.api));
    assert.equal(c[b.check].status, "at_risk", `${b.check} should be At Risk`);
    assert.ok((c[b.check].facts.failed as string[]).includes(b.failed), `expected "${b.failed}" among ${JSON.stringify(c[b.check].facts.failed)}`);
  });

test("a stronger claim never survives a weaker gateway: every break leaves at least one check that is not Verified", async () => {
  for (const b of BREAKS) assert.ok((await runIsolatedChecks({ rules }, b.api)).some((c) => c.status !== "verified"), b.name);
});

test("expectations come from the rules, not from Tend's own decision function: custom rules are reported as not tested", async () => {
  const custom = [{ tool: "read_note", action: "read", resourcePrefix: "standup", effect: "allow" }, { tool: "write_note", action: "create", effect: "approve" }] as never;
  const c = byId(await runIsolatedChecks({ rules: custom }));
  assert.ok((c.forbidden_refused.facts.notTested as string[]).includes("read_note"));
  assert.ok(!(c.forbidden_refused.facts.tested as string[]).includes("read_note"));
  assert.equal(c.forbidden_refused.status, "verified");
});

test("rules that spend money can't be exploited by the checks either: an old Allow on a payment is tested as Ask me first", async () => {
  const c = byId(await runIsolatedChecks({ rules: [{ tool: "pay_invoice", action: "execute", effect: "allow" }] as never }));
  assert.deepEqual(c.ask_first_holds.facts.tested, ["pay_invoice"]);
  assert.equal(c.ask_first_holds.status, "verified");
});

test("VerificationRun carries no overall verdict, and the shared types allow exactly three statuses", () => {
  const run: VerificationRun = { id: "x", agentId: "a", at: 0, configVersion: 1, enforcement: "enforce", durationMs: 1, checks: [], runsWithoutAsking: [] };
  assert.deepEqual(Object.keys(run).sort(), ["agentId", "at", "checks", "configVersion", "durationMs", "enforcement", "id", "runsWithoutAsking"]);
});
