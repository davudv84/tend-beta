// Independent verification on REAL PostgreSQL (several pooled connections): the concurrency guarantees of SECURITY-VERIFICATION.md that PGlite's
// single connection cannot show. Runs only with TEND_TEST_DATABASE_URL (npm run test:postgres sets it up); CI's "postgres" job does.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { cancelAuthorization, claimToken, consumeAuthorization, requestAuthorization, spendApproved } from "./authz.ts";
import { verifyAudit } from "./audit-chain.ts";
import { allowEventRemoval, enableIsolation, migrate, postgres, type DB } from "./db.ts";
import { bindWorkspace, withRequestContext } from "./db-context.ts";
/** As the application runs since row-level security: inside a request bound to a workspace (here the default one). */
const inDefault = <T>(fn: () => Promise<T>) => withRequestContext(async () => { bindWorkspace("default"); return fn(); });
import { HttpError } from "./http.ts";
import { agentByKey, decide, MAX_AGENTS_PER_WORKSPACE, registerAgent, revokeKey, setPolicy } from "./repo.ts";

const URL_ = process.env.TEND_TEST_DATABASE_URL ?? "";
// Logins created by a test get the base URL's password, so swapping only the user name in that URL connects as them (CI's PostgreSQL requires
// passwords over TCP; a local cluster that trusts local connections ignores it).
const ROLE_PW = (() => { try { return decodeURIComponent(new URL(URL_).password).replace(/'/g, "''"); } catch { return ""; } })() || "tend-test-login";
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

test("PV-5 least-privilege application role on real PostgreSQL: the flows work, the schema and the audit log cannot be changed, even with the maintenance flag", { skip }, async () => {
  const { runtimeGrantsSql, assertSchemaCurrent } = await import("./db.ts");
  const { spendApproved: spend, requestAuthorization: ask } = await import("./authz.ts");
  const t = await tempDb();
  const role = `tend_app_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  let appDb: DB | undefined;
  try {
    // the schema owner's side: create the role (no special attributes) and grant it exactly runtimeGrantsSql
    const owner = (await t.db.get<{ db: string }>("SELECT current_database() AS db"))!.db;
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT CONNECT ON DATABASE ${owner} TO ${role}`);
    await t.db.exec(runtimeGrantsSql(role));
    const u = new URL(URL_); u.pathname = `/${owner}`; u.username = role;
    appDb = await postgres(u.toString());
    await enableIsolation(appDb); // as the application starts it: restricted login, tenant context from the request
    await assertSchemaCurrent(appDb);
    // the application works under it (inside a tenant context, as since row-level security): register, ask, approve, spend once
    await inDefault(async () => {
      const { agent, apiKey } = await registerAgent(appDb!, { name: "least", model: "m", provider: "Custom" });
      await setPolicy(appDb!, agent.id, [{ tool: "wire", action: "send", effect: "approve" }], "enforce");
      const a = (await agentByKey(appDb!, apiKey))!;
      const { view } = await ask(appDb!, a, PAY, null);
      await decide(appDb!, view.id, "approved");
      await spend(appDb!, a, view.id, PAY);
    });
    assert.equal((await verifyAudit(t.db)).ok, true, "the audit chain verifies (read by the owner: the whole log)");
    // what it must NOT be able to do
    const denied = (sql: string) => inDefault(async () => { try { await appDb!.tx(async (q) => { await q.exec("SELECT set_config('tend.maintenance', 'on', true)"); await q.exec(sql); }); return "ALLOWED"; } catch (e) { return (e as { code?: string }).code ?? String(e); } });
    for (const sql of [
      "DELETE FROM events", "UPDATE events SET data = '{}'", "TRUNCATE events", "DELETE FROM auth_events", "UPDATE auth_events SET type = 'x'", "DELETE FROM verification_runs",
      "DROP TRIGGER events_append_only_rows ON events", "DROP TRIGGER events_chain ON events", "ALTER TABLE events DISABLE TRIGGER ALL", "ALTER TABLE agents ADD COLUMN x INT",
      "CREATE TABLE evil (x INT)", "CREATE OR REPLACE FUNCTION events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
      "DELETE FROM schema_migrations", "INSERT INTO schema_migrations VALUES (999, 0)", "DROP TABLE agents",
    ]) assert.equal(await denied(sql), "42501", `${sql} must be refused by privilege (42501), got ${await denied(sql)}`);
    assert.equal((await t.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM events"))!.n > 0, true, "the log is intact");
    // contrast, to show what the privilege split buys: the schema owner's role CAN erase the log by raising the same flag
    await t.db.tx(async (q) => { await allowEventRemoval(q); await q.run("DELETE FROM events WHERE type = 'agent.registered'"); });
    assert.equal((await verifyAudit(t.db)).ok, true, "(and an owner-role deletion of the oldest events passes a bare chain walk: that is why the runtime role must not be the owner)");
  } finally {
    await appDb?.close().catch(() => {});
    await t.close().catch(() => {});
    await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
    await admin.end();
  }
});

test("PV-6 start-up with separate migration and runtime roles on real PostgreSQL fails closed until the runtime role is set up, and when the schema is behind", { skip }, async () => {
  const { runtimeGrantsSql, getDb, MIGRATIONS } = await import("./db.ts");
  const g = globalThis as { __tendDb?: Promise<unknown> };
  const base = new pg.Client({ connectionString: URL_ });
  await base.connect();
  const name = `tend_split_${randomBytes(5).toString("hex")}`, role = `tend_run_${randomBytes(4).toString("hex")}`;
  await base.query(`CREATE DATABASE ${name}`);
  await base.query(`CREATE ROLE ${role} LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await base.query(`GRANT CONNECT ON DATABASE ${name} TO ${role}`);
  const urlFor = (user?: string) => { const u = new URL(URL_); u.pathname = `/${name}`; if (user) u.username = user; return u.toString(); };
  const saved = { a: process.env.DATABASE_URL, m: process.env.DATABASE_MIGRATE_URL, p: process.env.POSTGRES_URL, v: process.env.VERCEL };
  const start = async () => { g.__tendDb = undefined; try { const db = await getDb(); return { db }; } catch (e) { return { error: (e as Error).message }; } };
  let owner: DB | undefined;
  try {
    delete process.env.POSTGRES_URL; delete process.env.VERCEL;
    // 1. runtime login only, nothing migrated or granted: it cannot vouch for the schema → no start
    process.env.DATABASE_URL = urlFor(role); delete process.env.DATABASE_MIGRATE_URL;
    const first = await start();
    assert.ok(first.error, "no usable runtime role: the start fails");
    // 2. with the owner for migrations: it migrates AND grants the runtime login its privileges (every start), and revokes TEMP from PUBLIC
    process.env.DATABASE_MIGRATE_URL = urlFor();
    const second = await start();
    assert.ok(second.db, second.error);
    assert.equal((await second.db!.get<{ u: string }>("SELECT current_user AS u"))!.u, role, "the pool the application uses is the runtime role, not the owner");
    owner = await postgres(urlFor());
    const privs = (await owner.get<Record<string, boolean>>(`SELECT has_table_privilege('${role}', 'agents', 'SELECT') AS sel, has_table_privilege('${role}', 'events', 'DELETE') AS del,
      has_table_privilege('${role}', 'tend_context_keys', 'SELECT') AS keys, has_database_privilege('${role}', current_database(), 'TEMPORARY') AS tmp`))!;
    assert.deepEqual(privs, { sel: true, del: false, keys: false, tmp: false }, "grants as runtimeGrantsSql says, no key access, no temporary tables");
    assert.equal(runtimeGrantsSql(role).includes("REVOKE ALL ON tend_context_keys"), true);
    await second.db!.close();
    // 3. a migration this code expects is missing → the runtime role refuses to run on it (and the migrate connection would re-apply it, so test without it)
    await owner.run("DELETE FROM schema_migrations WHERE version = ?", MIGRATIONS.length);
    delete process.env.DATABASE_MIGRATE_URL;
    process.env.DATABASE_URL = urlFor(role);
    const third = await start();
    assert.ok(third.error, "runtime-only start on a schema that is missing a migration: the runtime role cannot migrate it, so it must not run");
  } finally {
    g.__tendDb = undefined;
    for (const [k, v] of [["DATABASE_URL", saved.a], ["DATABASE_MIGRATE_URL", saved.m], ["POSTGRES_URL", saved.p], ["VERCEL", saved.v]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    await owner?.close().catch(() => {});
    await base.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
    await base.query(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
    await base.end();
  }
});

test("PV-7 the application role cannot erase the audit log through a cascade from agents, nor rewrite the chain boundary", { skip }, async () => {
  const { runtimeGrantsSql } = await import("./db.ts");
  const t = await tempDb();
  const role = `tend_casc_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  let appDb: DB | undefined;
  try {
    const owner = (await t.db.get<{ db: string }>("SELECT current_database() AS db"))!.db;
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT CONNECT ON DATABASE ${owner} TO ${role}`);
    await t.db.exec(runtimeGrantsSql(role));
    const u = new URL(URL_); u.pathname = `/${owner}`; u.username = role;
    appDb = await postgres(u.toString());
    await enableIsolation(appDb); // as the application starts it: restricted login, tenant context from the request
    const { agent } = await inDefault(() => registerAgent(appDb!, { name: "victim", model: "m", provider: "Custom" }));
    const events = async () => (await t.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM events WHERE agent_id = ?", agent.id))!.n;
    assert.ok((await events()) > 0);
    const denied = (sql: string) => inDefault(async () => { try { await appDb!.tx(async (q) => { await q.exec("SELECT set_config('tend.maintenance', 'on', true)"); await q.exec(sql); }); return "ALLOWED"; } catch (e) { return (e as { code?: string }).code ?? String(e); } });
    assert.equal(await denied(`DELETE FROM agents WHERE id = '${agent.id}'`), "42501", "the cascade path is closed by privilege");
    assert.equal(await denied("DELETE FROM users"), "42501");
    assert.equal(await denied("DELETE FROM workspaces"), "42501");
    assert.ok((await events()) > 0, "the victim's history is intact");
    assert.equal(await denied("UPDATE meta SET value = '0' WHERE key = 'events.chain.v2_after'"), "42501", "chain boundary: refused");
    assert.equal(await denied("DELETE FROM meta WHERE key = 'events.chain.v2_after'"), "42501");
    assert.equal(await denied("UPDATE meta SET value = '1' WHERE key = 'demo.x'"), "OK".length ? "ALLOWED" : "", "other meta keys (demo state) stay writable");
    // the owner is not protected by privilege: the same flag erases the history through the cascade (why the application must not run as the owner)
    await t.db.tx(async (q) => { await allowEventRemoval(q); await q.run("DELETE FROM agents WHERE id = ?", agent.id); });
    assert.equal(await events(), 0, "contrast: as the owner role the cascade erases the agent's events");
  } finally {
    await appDb?.close().catch(() => {});
    await t.close().catch(() => {});
    await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
    await admin.end();
  }
});
