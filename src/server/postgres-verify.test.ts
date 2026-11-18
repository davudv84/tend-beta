// Independent verification on REAL PostgreSQL (several pooled connections): the concurrency guarantees of SECURITY-VERIFICATION.md that PGlite's
// single connection cannot show. Runs only with TEND_TEST_DATABASE_URL (npm run test:postgres sets it up); CI's "postgres" job does.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { cancelAuthorization, claimToken, consumeAuthorization, requestAuthorization, spendApproved } from "./authz.ts";
import { verifyAudit } from "./audit-chain.ts";
import { migrate, postgres, type DB } from "./db.ts";
import { HttpError } from "./http.ts";
import { agentByKey, decide, MAX_AGENTS_PER_WORKSPACE, registerAgent, revokeKey, setPolicy } from "./repo.ts";

const URL_ = process.env.TEND_TEST_DATABASE_URL ?? "";
const skip = URL_ ? false : "set TEND_TEST_DATABASE_URL (or run `npm run test:postgres`) to test against real PostgreSQL";
const PAY = { tool: "wire", action: "send", resource: "ACC-1", detail: "EUR 5.00 to X" };

async function tempDb() {
  const host = new URL(URL_).hostname;
  if (!["127.0.0.1", "localhost", "[::1]", "::1", ""].includes(host)) throw new Error(`TEND_TEST_DATABASE_URL must point at this machine, not ${host}`);
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  const name = `tend_verify_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(URL_); u.pathname = `/${name}`;
  const db = await postgres(u.toString());
  await migrate(db);
  await Promise.all(Array.from({ length: 6 }, () => db.get("SELECT pg_sleep(0.1)"))); // open the pool first: a cold pool quietly serialises "parallel" work
  return { db, close: async () => { await db.close(); await admin.query(`DROP DATABASE ${name} WITH (FORCE)`); await admin.end(); } };
}
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return e instanceof HttpError ? e.code : `ERR:${(e as Error).message.slice(0, 60)}`; } };

test("PV-1 real pool: 80 parallel registrations in one workspace store exactly MAX_AGENTS_PER_WORKSPACE agents", { skip }, async () => {
  const t = await tempDb();
  try {
    await t.db.run("INSERT INTO workspaces (id, name, created_at) VALUES ('wx', 'wx', 0)");
    const out = await Promise.all(Array.from({ length: MAX_AGENTS_PER_WORKSPACE + 30 }, (_, i) => code(registerAgent(t.db, { name: `a${i}`, model: "m", provider: "Custom" }, "u", "wx"))));
    assert.equal((await t.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM agents WHERE workspace_id = 'wx'"))!.n, MAX_AGENTS_PER_WORKSPACE);
    assert.equal(out.filter((x) => x === "OK").length, MAX_AGENTS_PER_WORKSPACE);
    assert.deepEqual([...new Set(out.filter((x) => x !== "OK"))], ["too_many_agents"]);
  } finally { await t.close(); }
});

test("PV-2 real pool: racing approve, reject, cancel and four spends: at most one spend, and only after a person approved", { skip }, async () => {
  const t = await tempDb();
  try {
    for (let round = 0; round < 12; round++) {
      const { agent, apiKey } = await registerAgent(t.db, { name: `r${round}`, model: "m", provider: "Custom" });
      await setPolicy(t.db, agent.id, [{ tool: "wire", action: "send", effect: "approve" }], "enforce");
      const a = (await agentByKey(t.db, apiKey))!;
      const { view } = await requestAuthorization(t.db, a, PAY, null);
      const res = await Promise.allSettled([decide(t.db, view.id, "approved"), decide(t.db, view.id, "rejected"), cancelAuthorization(t.db, a, view.id), ...Array.from({ length: 4 }, () => spendApproved(t.db, a, view.id, PAY))]);
      const spends = res.slice(3).filter((r) => r.status === "fulfilled").length;
      const row = (await t.db.get<{ status: string }>("SELECT status FROM authorizations WHERE id = ?", view.id))!;
      const review = (await t.db.get<{ status: string }>("SELECT status FROM reviews WHERE id = ?", view.id))!;
      assert.ok(spends <= 1, `round ${round}: ${spends} spends`);
      if (row.status === "consumed") assert.deepEqual([spends, review.status], [1, "approved"], `round ${round}`);
      else assert.equal(spends, 0);
      const consumedEvents = (await t.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM events WHERE type = 'authorization.consumed' AND agent_id = ?", agent.id))!.n;
      assert.equal(consumedEvents, row.status === "consumed" ? 1 : 0, "the audit log agrees with the authorization");
    }
    assert.equal((await verifyAudit(t.db)).ok, true);
  } finally { await t.close(); }
});

test("PV-3 real pool: revoking the key while 8 spends overlap: the action is authorized before the revocation or not at all, and the log agrees", { skip }, async () => {
  const t = await tempDb();
  try {
    for (let round = 0; round < 8; round++) {
      const { agent, apiKey } = await registerAgent(t.db, { name: `k${round}`, model: "m", provider: "Custom" });
      await setPolicy(t.db, agent.id, [{ tool: "wire", action: "send", effect: "approve" }], "enforce");
      const a = (await agentByKey(t.db, apiKey))!;
      const { view } = await requestAuthorization(t.db, a, PAY, null);
      await decide(t.db, view.id, "approved");
      const res = await Promise.allSettled([revokeKey(t.db, agent.id), ...Array.from({ length: 8 }, () => spendApproved(t.db, a, view.id, PAY))]);
      const spends = res.slice(1).filter((r) => r.status === "fulfilled").length;
      assert.ok(spends <= 1);
      const log = (await t.db.all<{ type: string; seq: number }>("SELECT type, seq FROM events WHERE agent_id = ? AND type IN ('authorization.consumed','key.revoked') ORDER BY seq", agent.id));
      if (spends === 1) assert.equal(log[0].type, "authorization.consumed", "a spend that succeeded is logged before the revocation");
      assert.equal(await agentByKey(t.db, apiKey), undefined);
    }
  } finally { await t.close(); }
});

test("PV-4 real pool: if the audit write fails, the authorization is not consumed (one transaction)", { skip }, async () => {
  const t = await tempDb();
  try {
    const { agent, apiKey } = await registerAgent(t.db, { name: "atomic", model: "m", provider: "Custom" });
    await setPolicy(t.db, agent.id, [{ tool: "wire", action: "send", effect: "approve" }], "enforce");
    const a = (await agentByKey(t.db, apiKey))!;
    const { view } = await requestAuthorization(t.db, a, PAY, null);
    await decide(t.db, view.id, "approved");
    await t.db.exec(`CREATE FUNCTION rt_block() RETURNS trigger AS $$ BEGIN IF NEW.type = 'authorization.consumed' THEN RAISE EXCEPTION 'audit write refused'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
                     CREATE TRIGGER rt_block_t BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION rt_block();`);
    assert.match(await code(spendApproved(t.db, a, view.id, PAY)), /^ERR:/);
    const tok = ((await claimToken(t.db, a, view.id)).view as unknown as { token: string }).token;
    assert.match(await code(consumeAuthorization(t.db, a, view.id, { token: tok, ...PAY })), /^ERR:/);
    assert.equal((await t.db.get<{ status: string }>("SELECT status FROM authorizations WHERE id = ?", view.id))!.status, "approved");
  } finally { await t.close(); }
});
