// Database-enforced tenant isolation on REAL PostgreSQL (row-level security, migration 18, src/server/db-context.ts). Skipped unless
// TEND_TEST_DATABASE_URL points at a PostgreSQL superuser on this machine (npm run test:postgres). Each test gets its own database and its own
// runtime role, both removed afterwards. The point of these tests: tenant data stays apart EVEN WHEN the application's own checks are bypassed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { decide, registerAgent, agentInWorkspace, setPolicy, agentByKey, ingestEvents } from "./repo.ts";
import { requestAuthorization, spendApproved } from "./authz.ts";
import { asSystem, bindWorkspace, withRequestContext } from "./db-context.ts";
import { contextSignature, enableIsolation, migrate, postgres, RLS_TABLES, runtimeGrantsSql, type DB } from "./db.ts";
import { HttpError } from "./http.ts";

const URL_ = process.env.TEND_TEST_DATABASE_URL ?? "";
const skip = URL_ ? false : "set TEND_TEST_DATABASE_URL (or run `npm run test:postgres`) to test against real PostgreSQL";
const PAY = { tool: "wire", action: "send", resource: "ACC-1", detail: "EUR 5.00 to X" };
const asTenant = <T>(ws: string, fn: () => Promise<T>) => withRequestContext(async () => { bindWorkspace(ws); return fn(); });
const noContext = <T>(fn: () => Promise<T>) => withRequestContext(fn);
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return e instanceof HttpError ? e.code : ((e as { code?: string }).code ?? (e as Error).message.slice(0, 80)); } };

async function world() {
  const host = new URL(URL_).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) throw new Error("TEND_TEST_DATABASE_URL must point at this machine");
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  const name = `tend_rls_${randomBytes(5).toString("hex")}`, role = `tend_rt_${randomBytes(4).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(URL_); u.pathname = `/${name}`;
  const db = await postgres(u.toString());
  await migrate(db);
  await Promise.all(Array.from({ length: 6 }, () => db.get("SELECT pg_sleep(0.05)")));
  // two tenants with one of everything, created as the owner (before isolation is on)
  await db.run("INSERT INTO workspaces (id, name, created_at) VALUES ('wa', 'A', 0), ('wb', 'B', 0)");
  const A = await registerAgent(db, { name: "alpha", model: "m", provider: "Custom" }, "u", "wa");
  const B = await registerAgent(db, { name: "bravo", model: "m", provider: "Custom" }, "u", "wb");
  for (const x of [A, B]) await setPolicy(db, x.agent.id, [{ tool: "wire", action: "send", effect: "approve" }], "enforce");
  const bAgent = (await agentByKey(db, B.apiKey))!;
  const bAuth = (await requestAuthorization(db, bAgent, PAY, null)).view.id;
  await db.run("INSERT INTO users (id, email, password_hash, workspace_id, created_at, password_changed_at) VALUES ('ua', 'a@example.com', 'x', 'wa', 0, 0), ('ub', 'b@example.com', 'x', 'wb', 0, 0)");
  await db.run("INSERT INTO notifications (id, workspace_id, kind, dedup_key, created_at, updated_at, push) VALUES ('na', 'wa', 'test', 'k', 0, 0, 'none'), ('nb', 'wb', 'test', 'k', 0, 0, 'none')");
  await db.run("INSERT INTO central_policies (id, name, policy, version, created_at, updated_at, workspace_id) VALUES ('cpb', 'B', '[]', 1, 0, 0, 'wb')");
  await enableIsolation(db, role);
  return {
    db, A, B, bAuth, role,
    close: async () => { await db.close(); await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => {}); await admin.end(); },
  };
}

test("RLS-1 start-up: isolation is on, every transaction runs as a role that is not a superuser, has no BYPASSRLS and owns nothing", { skip }, async () => {
  const w = await world();
  try {
    assert.equal(w.db.isolation?.on, true);
    const me = await asTenant("wa", () => w.db.get<{ u: string; sup: string; bypass: boolean }>("SELECT current_user AS u, current_setting('is_superuser') AS sup, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass"));
    assert.deepEqual([me!.u, me!.sup, me!.bypass], [w.role, "off", false]);
    for (const t of RLS_TABLES) assert.equal((await w.db.get<{ on: boolean }>(`SELECT relrowsecurity AS on FROM pg_class WHERE oid = 'public.${t}'::regclass`))?.on, true, t);
  } finally { await w.close(); }
});

test("RLS-2 a tenant sees and changes only its own rows, even through code with NO workspace check (the application's checks bypassed)", { skip }, async () => {
  const w = await world();
  try {
    await asTenant("wa", async () => {
      // raw reads, as a buggy query without a workspace filter would make them
      for (const [sql, label] of [["SELECT id FROM agents", "agents"], ["SELECT id FROM workspaces", "workspaces"], ["SELECT agent_id FROM events", "events"], ["SELECT id FROM authorizations", "authorizations"],
        ["SELECT id FROM reviews", "reviews"], ["SELECT id FROM users", "users"], ["SELECT id FROM notifications", "notifications"], ["SELECT id FROM central_policies", "central policies"]] as const) {
        const rows = JSON.stringify(await w.db.all(sql));
        assert.ok(!rows.includes(w.B.agent.id) && !rows.includes("wb") && !rows.includes(w.bAuth) && !rows.includes("ub") && !rows.includes("nb") && !rows.includes("cpb"), `${label}: ${rows.slice(0, 200)}`);
      }
      assert.equal(await w.db.get("SELECT * FROM agents WHERE id = ?", w.B.agent.id), undefined);
      // writes aimed at B's rows touch nothing
      assert.equal(await w.db.run("UPDATE authorizations SET status = 'approved', approved_until = 9e15 WHERE id = ?", w.bAuth), 0);
      assert.equal(await w.db.run("UPDATE agents SET policy = '[]', status = 'paused' WHERE id = ?", w.B.agent.id), 0);
      assert.equal(await w.db.run("DELETE FROM notifications WHERE id = 'nb'"), 0);
      // writes that would CREATE rows in B are refused by WITH CHECK
      assert.equal(await code(w.db.run("INSERT INTO events (id, agent_id, type, at, actor, data) VALUES ('ev_x', ?, 'task.started', 1, 'agent', '{}')", w.B.agent.id)), "42501");
      assert.equal(await code(w.db.run("INSERT INTO agents (id, profile, origin, created_at, workspace_id) VALUES ('evil', '{}', 'connected', 0, 'wb')")), "42501");
      assert.equal(await code(w.db.run("UPDATE agents SET workspace_id = 'wb' WHERE id = ?", w.A.agent.id)), "42501", "a row cannot be moved into another tenant");
      // service functions called WITHOUT the route's workspace check: B's review is simply not there
      assert.equal(await code(decide(w.db, w.bAuth, "approved")), "review_not_found");
      assert.equal(await code(agentInWorkspace(w.db, "wb", w.B.agent.id)), "agent_not_found", "even asking for B's workspace by name finds nothing");
    });
    // and B's request is untouched
    const b = await asSystem(() => w.db.get<{ status: string }>("SELECT status FROM authorizations WHERE id = ?", w.bAuth));
    assert.equal(b?.status, "pending");
  } finally { await w.close(); }
});

test("RLS-3 no context, or an unauthenticated request, sees nothing tenant-scoped (fail closed); the admin's explicit system scope sees all", { skip }, async () => {
  const w = await world();
  try {
    assert.equal((await w.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM agents"))!.n, 0, "no request context at all");
    assert.equal((await noContext(() => w.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM events")))!.n, 0, "a request before authentication");
    assert.equal(await noContext(() => w.db.run("UPDATE authorizations SET status = 'approved'")), 0);
    assert.equal((await asSystem(() => w.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM agents")))!.n, 2);
  } finally { await w.close(); }
});

test("RLS-4 no cross-request contamination on the pool: 200 interleaved requests of two tenants each see only their own; nothing outlives its transaction", { skip }, async () => {
  const w = await world();
  try {
    const out = await Promise.all(Array.from({ length: 200 }, (_, i) => { const ws = i % 2 ? "wa" : "wb"; return asTenant(ws, async () => ({ ws, ids: (await w.db.all<{ workspace_id: string }>("SELECT workspace_id FROM agents")).map((r) => r.workspace_id) })); }));
    for (const r of out) assert.deepEqual([...new Set(r.ids)], [r.ws]);
    // after all that, a statement with no context on the same pooled connections sees nothing: SET LOCAL ended with each transaction
    const leftovers = await Promise.all(Array.from({ length: 12 }, () => w.db.get<{ n: number; ws: string }>("SELECT COUNT(*)::int AS n, current_setting('tend.workspace', true) AS ws FROM agents")));
    for (const l of leftovers) assert.deepEqual([l!.n, l!.ws ?? ""], [0, ""]);
    // and the real flows still work inside a tenant
    await asTenant("wa", async () => {
      const a = (await agentByKey(w.db, w.A.apiKey))!; // (the route does this as system; here the tenant can read its own agent)
      const { view } = await requestAuthorization(w.db, a, PAY, null);
      await decide(w.db, view.id, "approved");
      assert.equal((await spendApproved(w.db, a, view.id, PAY)).authorized, true);
      await ingestEvents(w.db, a, [{ type: "task.started", data: { taskId: "t", title: "x" } }]);
    });
  } finally { await w.close(); }
});

test("RLS-5 negative controls: with row-level security switched off on one table, the leak appears and start-up refuses; the known owner-login gap (RESET ROLE) is real", { skip }, async () => {
  const w = await world();
  try {
    // owner switches RLS off on agents (as a broken migration would): the same tenant query now leaks B's agent
    await asSystem(async () => {}); // (no-op: the owner acts below through a separate owner pool)
    const owner = await postgres(new URL(URL_.replace(/\/[^/]*$/, `/${(await w.db.get<{ d: string }>("SELECT current_database() AS d"))!.d}`)).toString());
    await owner.exec("ALTER TABLE agents DISABLE ROW LEVEL SECURITY");
    const leaked = await asTenant("wa", () => w.db.get("SELECT id FROM agents WHERE id = ?", w.B.agent.id));
    assert.ok(leaked, "the test detects the missing policy: without RLS on agents, tenant A reads B's agent");
    w.db.isolation!.on = false;
    await assert.rejects(enableIsolation(w.db, w.role), /row-level security is off on: agents/, "and start-up refuses to run 'isolated'");
    await owner.exec("ALTER TABLE agents ENABLE ROW LEVEL SECURITY");
    await enableIsolation(w.db, w.role);
    // documented limitation: when the login role is the schema owner (the default single-URL deployment), SQL running in the session can RESET ROLE
    // and leave the runtime role. The policies stop the application's own mistakes, not SQL injection; see docs/database-roles.md.
    const escaped = await asTenant("wa", () => w.db.tx(async (q) => { await q.exec("RESET ROLE"); return q.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM agents"); }));
    assert.equal(escaped!.n, 2, "KNOWN GAP (owner login): RESET ROLE escapes. With a restricted login role (RLS-6) it does not.");
    await owner.close();
  } finally { await w.close(); }
});

test("RLS-6 with a restricted LOGIN role (DATABASE_MIGRATE_URL split), RESET ROLE and set_config do not escape the tenant boundary... except tend.system, which is a setting", { skip }, async () => {
  const w = await world();
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  const login = `tend_login_${randomBytes(4).toString("hex")}`;
  let rt: DB | undefined;
  try {
    const dbName = (await w.db.get<{ d: string }>("SELECT current_database() AS d"))!.d;
    await admin.query(`CREATE ROLE ${login} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${login}`);
    const owner = await postgres(new URL(URL_.replace(/\/[^/]*$/, `/${dbName}`)).toString());
    await owner.exec(runtimeGrantsSql(login));
    await owner.close();
    const u = new URL(URL_); u.pathname = `/${dbName}`; u.username = login;
    rt = await postgres(u.toString());
    await enableIsolation(rt, "unused_role_name");
    assert.equal(rt.isolation?.role, "", "a restricted login is used as is, no role switch");
    const escaped = await asTenant("wa", () => rt!.tx(async (q) => { await q.exec("RESET ROLE"); return q.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM agents"); }));
    assert.equal(escaped!.n, 1, "RESET ROLE changes nothing for a login that is the runtime role");
    // the residual gap, stated as a test: SQL in the session can raise tend.system (a setting, not a privilege)
    const raised = await asTenant("wa", () => rt!.tx(async (q) => { await q.exec("SELECT set_config('tend.system', 'on', true)"); return q.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM agents"); }));
    assert.equal(raised!.n, 2, "KNOWN GAP: an attacker who can run SQL in the application's session can raise the system setting; RLS is not a defence against SQL injection here");
  } finally { await rt?.close().catch(() => {}); await w.close(); await admin.query(`DROP OWNED BY ${login}`).catch(() => {}); await admin.query(`DROP ROLE IF EXISTS ${login}`).catch(() => {}); await admin.end(); }
});

test("RLS-7 the audit hash chain stays one global chain when tenants write interleaved under row-level security", { skip }, async () => {
  const { verifyAudit } = await import("./audit-chain.ts");
  const w = await world();
  try {
    for (let i = 0; i < 6; i++) {
      for (const [ws, key] of [["wa", w.A.apiKey], ["wb", w.B.apiKey]] as const)
        await asTenant(ws, async () => { const a = (await agentByKey(w.db, key))!; await ingestEvents(w.db, a, [{ type: "task.started", data: { taskId: `t${i}`, title: `${ws}-${i}` } }]); });
    }
    const r = await asSystem(() => verifyAudit(w.db));
    assert.equal(r.ok, true, JSON.stringify(r));
  } finally { await w.close(); }
});

test("RLS-8 start-up refuses a loose policy, a runtime role that is a member of the owner, and works for a non-superuser owner with CREATEROLE (the Neon-style setup)", { skip }, async () => {
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  const name = `tend_rls8_${randomBytes(5).toString("hex")}`, owner = `tend_own_${randomBytes(4).toString("hex")}`, rt = `tend_rt8_${randomBytes(4).toString("hex")}`;
  let db: DB | undefined;
  try {
    // a NON-superuser schema owner that may create roles, like a managed provider's default database owner
    await admin.query(`CREATE ROLE ${owner} LOGIN NOSUPERUSER CREATEDB CREATEROLE NOBYPASSRLS`);
    await admin.query(`CREATE DATABASE ${name} OWNER ${owner}`);
    const u = new URL(URL_); u.pathname = `/${name}`; u.username = owner;
    db = await postgres(u.toString());
    await migrate(db);
    await enableIsolation(db, rt);
    assert.equal(db.isolation?.on, true);
    assert.equal((await withRequestContext(async () => { bindWorkspace("wa"); return db!.get<{ u: string }>("SELECT current_user AS u"); }))!.u, rt, "the non-superuser owner switches to the runtime role");
    // a loose policy added later (as a careless migration would) is refused at the next start
    await asOwnerQuery(db, `CREATE POLICY open_all ON agents USING (true)`);
    db.isolation!.on = false;
    await assert.rejects(enableIsolation(db, rt), /unexpected row-level security policies: agents\.open_all/);
    await asOwnerQuery(db, `DROP POLICY open_all ON agents`);
    // a separate runtime LOGIN that is a member of the owner (split deployment set up wrongly): owner rights flow to it, so start-up refuses
    await admin.query(`CREATE ROLE ${rt}_l LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE ${owner}`);
    const ul = new URL(URL_); ul.pathname = `/${name}`; ul.username = `${rt}_l`;
    const member = await postgres(ul.toString());
    try { await assert.rejects(enableIsolation(member, rt), /owns tables, or is a member of a role that does/); } finally { await member.close(); }
    await admin.query(`DROP ROLE ${rt}_l`);
    db.isolation!.on = false;
    await enableIsolation(db, rt);
  } finally {
    await db?.close().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
    for (const r of [rt, owner]) { await admin.query(`DROP OWNED BY ${r}`).catch(() => {}); await admin.query(`DROP ROLE IF EXISTS ${r}`).catch(() => {}); }
    await admin.end();
  }
});
/** A statement as the login role itself (no runtime-role switch): what a migration would do. */
async function asOwnerQuery(db: DB, sql: string) { const { asOwner } = await import("./db-context.ts"); await asOwner(() => db.exec(sql)); }

test("RLS-9 signed tenant context (TEND_CONTEXT_KEY) with a restricted login: SQL running in the session cannot raise system or switch tenant; without the key installed it could (negative control)", { skip }, async () => {
  const saved = process.env.TEND_CONTEXT_KEY;
  process.env.TEND_CONTEXT_KEY = randomBytes(32).toString("base64url");
  const w = await world(); // the owner pool installs the key as it enables isolation
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  const login = `tend_sig_${randomBytes(4).toString("hex")}`;
  let rt: DB | undefined;
  try {
    const dbName = (await w.db.get<{ d: string }>("SELECT current_database() AS d"))!.d;
    await admin.query(`CREATE ROLE ${login} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${login}`);
    const ownerUrl = new URL(URL_); ownerUrl.pathname = `/${dbName}`;
    const owner = await postgres(ownerUrl.toString());
    await owner.exec(runtimeGrantsSql(login));
    const u = new URL(URL_); u.pathname = `/${dbName}`; u.username = login;
    rt = await postgres(u.toString());
    await enableIsolation(rt, "unused_role_name");
    const count = (sql: string, ws = "wa") => asTenant(ws, () => rt!.tx(async (q) => { if (sql) await q.exec(sql); return (await q.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM agents"))!.n; }));
    assert.equal(await count(""), 1, "a properly signed context sees its own tenant");
    // what RLS-6 showed working without a key: raising the system setting from SQL. Signed: the context no longer verifies, so nothing is visible.
    assert.equal(await count("SELECT set_config('tend.system', 'on', true)"), 0, "raising tend.system invalidates the context (fail closed)");
    assert.equal(await count("SELECT set_config('tend.workspace', 'wb', true)"), 0, "switching tend.workspace invalidates it");
    assert.equal(await count("SELECT set_config('tend.ctx_mac', repeat('0', 64), true)"), 0, "a made-up MAC does not verify");
    assert.equal(await count("RESET ROLE; SELECT set_config('tend.system', 'on', true)"), 0, "and RESET ROLE does not help a restricted login");
    // the key itself is out of reach of the runtime role
    const denied = async (sql: string) => { try { await asTenant("wa", () => rt!.exec(sql)); return "ALLOWED"; } catch (e) { return (e as { code?: string }).code; } };
    for (const sql of ["SELECT * FROM tend_context_keys", "DELETE FROM tend_context_keys", "INSERT INTO tend_context_keys VALUES ('x', 'x', 0)", "CREATE OR REPLACE FUNCTION tend_ctx_valid() RETURNS boolean LANGUAGE sql AS 'SELECT true'"])
      assert.equal(await denied(sql), "42501", sql);
    // a server started with another key (or none) while the database holds keys: refused at start-up, never silently blind
    process.env.TEND_CONTEXT_KEY = randomBytes(32).toString("base64url");
    rt.isolation!.on = false;
    await assert.rejects(enableIsolation(rt, "unused_role_name"), /context keys and this server's TEND_CONTEXT_KEY is not one of them/);
    // negative control: with no key installed (the owner removes them), the same forgery works again: the protection is the signature
    await owner.exec("DELETE FROM tend_context_keys");
    delete process.env.TEND_CONTEXT_KEY;
    await enableIsolation(rt, "unused_role_name");
    assert.equal(await count("SELECT set_config('tend.system', 'on', true)"), 2, "unsigned: raising the setting reads every tenant (the RLS-6 gap)");
    await owner.close();
  } finally {
    if (saved === undefined) delete process.env.TEND_CONTEXT_KEY; else process.env.TEND_CONTEXT_KEY = saved;
    await rt?.close().catch(() => {}); await w.close();
    await admin.query(`DROP OWNED BY ${login}`).catch(() => {}); await admin.query(`DROP ROLE IF EXISTS ${login}`).catch(() => {}); await admin.end();
  }
});

test("RLS-10 a signed context captured from one transaction cannot be replayed after its freshness window (nonce carries the issue time)", { skip }, async () => {
  const saved = process.env.TEND_CONTEXT_KEY;
  process.env.TEND_CONTEXT_KEY = randomBytes(32).toString("base64url");
  const w = await world();
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  const login = `tend_rep_${randomBytes(4).toString("hex")}`;
  let rt: DB | undefined;
  try {
    const dbName = (await w.db.get<{ d: string }>("SELECT current_database() AS d"))!.d;
    await admin.query(`CREATE ROLE ${login} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${login}`);
    const ownerUrl = new URL(URL_); ownerUrl.pathname = `/${dbName}`;
    const owner = await postgres(ownerUrl.toString());
    await owner.exec(runtimeGrantsSql(login));
    const u = new URL(URL_); u.pathname = `/${dbName}`; u.username = login;
    rt = await postgres(u.toString());
    await enableIsolation(rt, "unused_role_name");
    // SQL injected into a system transaction (e.g. the session lookup) can read the signed settings and keep them somewhere
    const cap = (await withRequestContext(() => asSystem(() => rt!.tx((q) => q.get<{ nonce: string; kid: string; mac: string }>(
      "SELECT current_setting('tend.ctx_nonce', true) AS nonce, current_setting('tend.ctx_kid', true) AS kid, current_setting('tend.ctx_mac', true) AS mac")))))!;
    const replay = (c: { nonce: string; kid: string; mac: string }) => `SELECT set_config('tend.workspace', '', true), set_config('tend.system', 'on', true), set_config('tend.ctx_nonce', '${c.nonce}', true), set_config('tend.ctx_kid', '${c.kid}', true), set_config('tend.ctx_mac', '${c.mac}', true)`;
    const count = (sql: string) => asTenant("wa", () => rt!.tx(async (q) => { if (sql) await q.exec(sql); return (await q.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM agents"))!.n; }));
    assert.match(cap.nonce, /^\d{13}\.[0-9a-f]{32}$/, "the nonce carries the time it was issued");
    // residual, stated in docs/database-roles.md: replayed within the window, a captured system context still works
    assert.equal(await count(replay(cap)), 2, "fresh capture replayed at once: still valid (the window is the bound)");
    // what a capture from 10 minutes ago looks like (signed with the real key, issue time in the past) and one claiming to be from the future
    for (const offset of [-10 * 60_000, -2 * 60_000, 10 * 60_000]) {
      const nonce = `${Date.now() + offset}.${randomBytes(16).toString("hex")}`;
      const old = contextSignature("", "on", nonce)!;
      assert.equal(await count(replay(old)), 0, `a context issued ${offset / 1000} s from now is refused`);
    }
    const altered = { ...cap, nonce: cap.nonce.replace(/^\d+/, String(Date.now())) };
    assert.equal(await count(replay(altered)), 0, "rewriting the issue time breaks the MAC");
    await owner.close();
  } finally {
    if (saved === undefined) delete process.env.TEND_CONTEXT_KEY; else process.env.TEND_CONTEXT_KEY = saved;
    await rt?.close().catch(() => {}); await w.close();
    await admin.query(`DROP OWNED BY ${login}`).catch(() => {}); await admin.query(`DROP ROLE IF EXISTS ${login}`).catch(() => {}); await admin.end();
  }
});
