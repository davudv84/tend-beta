// Database-enforced tenant isolation on REAL PostgreSQL (row-level security, migration 18, src/server/db-context.ts). Skipped unless
// TEND_TEST_DATABASE_URL points at a PostgreSQL superuser on this machine (npm run test:postgres). Each test gets its own database and its own
// runtime role, both removed afterwards. The point of these tests: tenant data stays apart EVEN WHEN the application's own checks are bypassed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { decide, registerAgent, agentInWorkspace, setPolicy, agentByKey, ingestEvents, workspaceOf } from "./repo.ts";
import { requestAuthorization, spendApproved } from "./authz.ts";
import { asSystem, bindWorkspace, withRequestContext } from "./db-context.ts";
import { contextSignature, enableIsolation, migrate, postgres, RLS_TABLES, runtimeGrantsSql, type DB } from "./db.ts";
import { HttpError } from "./http.ts";

const URL_ = process.env.TEND_TEST_DATABASE_URL ?? "";
// Logins created by a test get the base URL's password, so swapping only the user name in that URL connects as them (CI's PostgreSQL requires
// passwords over TCP; a local cluster that trusts local connections ignores it).
const ROLE_PW = (() => { try { return decodeURIComponent(new URL(URL_).password).replace(/'/g, "''"); } catch { return ""; } })() || "tend-test-login";
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
    await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
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
    await admin.query(`CREATE ROLE ${owner} LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER CREATEDB CREATEROLE NOBYPASSRLS`);
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
    await admin.query(`CREATE ROLE ${rt}_l LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER NOBYPASSRLS IN ROLE ${owner}`);
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
    await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
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

test("RLS-10 a signed context captured from one transaction cannot be replayed in any other transaction (bound to backend pid and transaction start)", { skip }, async () => {
  const saved = process.env.TEND_CONTEXT_KEY;
  process.env.TEND_CONTEXT_KEY = randomBytes(32).toString("base64url");
  const w = await world();
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  const login = `tend_rep_${randomBytes(4).toString("hex")}`;
  let rt: DB | undefined;
  try {
    const dbName = (await w.db.get<{ d: string }>("SELECT current_database() AS d"))!.d;
    await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
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
    assert.match(cap.nonce, /^\d+\.\d{16}$/, "the nonce names the transaction: backend pid and start time in microseconds");
    // replayed in the very next transaction (same pool, maybe the same backend): refused at once, there is no window any more
    for (let i = 0; i < 8; i++) assert.equal(await count(replay(cap)), 0, "a captured context replayed in a later transaction is refused");
    // signed with the real key for a made-up binding (this backend's pid, a time near now): still refused, the time must be the transaction's own
    for (const offset of [-1, 1, -60_000_000, 60_000_000]) {
      const [pid, us] = cap.nonce.split(".");
      const nonce = `${pid}.${BigInt(us) + BigInt(offset)}`;
      assert.equal(await count(replay(contextSignature("", "on", nonce)!)), 0, `a context bound to another start time (${offset} µs) is refused`);
    }
    const altered = { ...cap, nonce: cap.nonce.replace(/^\d+/, "1") };
    assert.equal(await count(replay(altered)), 0, "rewriting the pid breaks the MAC");
    // and the server's own, properly bound context keeps working
    assert.equal(await count(""), 1);
    await owner.close();
  } finally {
    if (saved === undefined) delete process.env.TEND_CONTEXT_KEY; else process.env.TEND_CONTEXT_KEY = saved;
    await rt?.close().catch(() => {}); await w.close();
    await admin.query(`DROP OWNED BY ${login}`).catch(() => {}); await admin.query(`DROP ROLE IF EXISTS ${login}`).catch(() => {}); await admin.end();
  }
});

test("RLS-11 SQL injected into one request cannot leave a temp table (or a session search_path) on a pooled connection that shadows a real table in later requests", { skip }, async () => {
  const saved = process.env.TEND_CONTEXT_KEY;
  process.env.TEND_CONTEXT_KEY = randomBytes(32).toString("base64url");
  const w = await world();
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  const login = `tend_tmp_${randomBytes(4).toString("hex")}`;
  let rt: DB | undefined;
  try {
    const dbName = (await w.db.get<{ d: string }>("SELECT current_database() AS d"))!.d;
    await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${login}`);
    const ownerUrl = new URL(URL_); ownerUrl.pathname = `/${dbName}`;
    const owner = await postgres(ownerUrl.toString());
    await owner.exec(runtimeGrantsSql(login));
    const u = new URL(URL_); u.pathname = `/${dbName}`; u.username = login;
    rt = await postgres(u.toString());
    await enableIsolation(rt, "unused_role_name");
    // tenant A's injected SQL, repeated so that every pooled connection gets it: A's own agent row, moved to workspace B, in a temp `agents`
    // (PUBLIC holds TEMP on a database by default, so the restricted role can create one), plus a session-level search_path change
    for (let i = 0; i < 12; i++) await asTenant("wa", () => rt!.tx((q) => q.exec(
      "CREATE TEMP TABLE IF NOT EXISTS agents AS SELECT * FROM public.agents WITH NO DATA; DELETE FROM pg_temp.agents; INSERT INTO pg_temp.agents SELECT * FROM public.agents; UPDATE pg_temp.agents SET workspace_id = 'wb'; SELECT set_config('search_path', 'pg_temp, public', false)")));
    assert.equal(await asTenant("wa", () => rt!.tx(async (q) => (await q.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM pg_temp.agents WHERE workspace_id = 'wb'"))!.n)) >= 1, true, "the forged temp table exists");
    // later requests: agent A authenticates as the server does it (asSystem), on whichever pooled connection
    const workspaces = new Set<string | undefined>();
    for (let i = 0; i < 12; i++) workspaces.add(await withRequestContext(() => asSystem(async () => { const a = await agentByKey(rt!, w.A.apiKey); return a && workspaceOf(a); })));
    assert.deepEqual([...workspaces], ["wa"], "agent A's key always resolves to its own workspace, never the forged one");
    await owner.close();
  } finally {
    if (saved === undefined) delete process.env.TEND_CONTEXT_KEY; else process.env.TEND_CONTEXT_KEY = saved;
    await rt?.close().catch(() => {}); await w.close();
    await admin.query(`DROP OWNED BY ${login}`).catch(() => {}); await admin.query(`DROP ROLE IF EXISTS ${login}`).catch(() => {}); await admin.end();
  }
});

test("RLS-12 production start-up rules with distinct roles (Neon-style owner): owner login refused, restricted login + signed context required, privileged memberships refused; injected SQL under the restricted login gets nothing", { skip }, async () => {
  const { getDb } = await import("./db.ts");
  const g = globalThis as { __tendDb?: Promise<unknown> };
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  const id = randomBytes(4).toString("hex");
  const name = `tend_prod_${id}`, owner = `tend_own_${id}`, login = `tend_app_${id}`, bypass = `tend_byp_${id}`, rt = `tend_nl_${id}`;
  const urlFor = (user: string) => { const u = new URL(URL_); u.pathname = `/${name}`; u.username = user; return u.toString(); };
  const keys = ["DATABASE_URL", "DATABASE_MIGRATE_URL", "POSTGRES_URL", "VERCEL", "TEND_DB_STRICT", "TEND_DB_ISOLATION", "TEND_DB_ALLOW_OWNER_LOGIN", "TEND_CONTEXT_KEY", "TEND_DB_RUNTIME_ROLE"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const start = async () => { g.__tendDb = undefined; try { return { db: (await getDb()) as DB }; } catch (e) { return { error: (e as Error).message }; } };
  const started: DB[] = [];
  try {
    await admin.query(`CREATE ROLE ${owner} LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER CREATEDB CREATEROLE NOBYPASSRLS`); // like neondb_owner
    await admin.query(`CREATE DATABASE ${name} OWNER ${owner}`);
    await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT CONNECT ON DATABASE ${name} TO ${login}`);
    for (const k of keys) delete process.env[k];
    process.env.TEND_DB_STRICT = "1"; process.env.TEND_DB_ISOLATION = "on"; process.env.TEND_DB_RUNTIME_ROLE = rt;
    // 1. one URL, the owner: refused in production; accepted only with the explicit, logged exception
    process.env.DATABASE_URL = urlFor(owner);
    const s1 = await start();
    assert.match(s1.error ?? "", /login tend_own_\w+ owns the tables or can become a privileged role/, "owner login refused");
    process.env.TEND_DB_ALLOW_OWNER_LOGIN = "1";
    const s1b = await start();
    assert.ok(s1b.db, s1b.error); started.push(s1b.db!);
    delete process.env.TEND_DB_ALLOW_OWNER_LOGIN;
    // 2. restricted login + owner for migrations, but no context key: refused
    process.env.DATABASE_URL = urlFor(login); process.env.DATABASE_MIGRATE_URL = urlFor(owner);
    assert.match((await start()).error ?? "", /TEND_CONTEXT_KEY is not set/);
    // 3. with a key: starts, as the restricted login
    process.env.TEND_CONTEXT_KEY = randomBytes(32).toString("base64url");
    const s3 = await start();
    assert.ok(s3.db, s3.error); started.push(s3.db!);
    const db = s3.db!;
    const ownerDb = await postgres(urlFor(owner)); started.push(ownerDb);
    await ownerDb.run("INSERT INTO workspaces (id, name, created_at) VALUES ('wa', 'A', 0), ('wb', 'B', 0) ON CONFLICT DO NOTHING");
    await registerAgent(ownerDb, { name: "alpha", model: "m", provider: "Custom" }, "u", "wa");
    await registerAgent(ownerDb, { name: "bravo", model: "m", provider: "Custom" }, "u", "wb");
    const count = (sql: string) => asTenant("wa", () => db.tx(async (q) => { if (sql) await q.exec(sql); return (await q.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM agents"))!.n; }));
    const err = async (sql: string) => { try { await asTenant("wa", () => db.tx((q) => q.exec(sql))); return "ALLOWED"; } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; } };
    assert.equal(await count(""), 1, "own tenant only");
    // injected SQL, everything it could try to get out of its tenant
    assert.equal(await count("RESET ROLE; SELECT set_config('tend.system', 'on', true)"), 0, "no role to go back to, and an unsigned system flag shows nothing");
    assert.equal(await count("SELECT set_config('tend.workspace', 'wb', true)"), 0);
    assert.equal(await err(`SET ROLE ${owner}`), "42501", "cannot become the owner");
    assert.equal(await err("CREATE TEMP TABLE agents (id text)"), "42501", "cannot create temporary tables");
    assert.equal(await err("SELECT * FROM tend_context_keys"), "42501", "cannot read the signing keys");
    assert.equal(await err("ALTER TABLE agents DISABLE ROW LEVEL SECURITY"), "42501", "cannot switch RLS off");
    assert.equal(await err("CREATE FUNCTION public.x() RETURNS int LANGUAGE sql AS 'SELECT 1'"), "42501", "cannot create objects");
    // session-level state left behind on pooled connections does not reach the next request
    for (let i = 0; i < 8; i++) await asTenant("wa", () => db.tx((q) => q.exec("SELECT set_config('tend.workspace', 'wb', false), set_config('tend.system', 'on', false), set_config('search_path', 'pg_temp, public', false)")));
    for (let i = 0; i < 8; i++) assert.equal(await count(""), 1, "the next request is still exactly tenant A");
    assert.equal(await asTenant("wb", () => db.tx(async (q) => (await q.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM agents"))!.n)), 1, "and tenant B exactly B");
    // 4. the runtime login made a member of a BYPASSRLS role (or given CREATEROLE): refused
    await admin.query(`CREATE ROLE ${bypass} NOLOGIN BYPASSRLS`);
    await admin.query(`GRANT ${bypass} TO ${login}`);
    assert.match((await start()).error ?? "", /member of a superuser, BYPASSRLS or CREATEROLE role/);
    await admin.query(`REVOKE ${bypass} FROM ${login}`);
    await admin.query(`ALTER ROLE ${login} CREATEROLE`);
    assert.match((await start()).error ?? "", /has CREATEROLE/);
    await admin.query(`ALTER ROLE ${login} NOCREATEROLE`);
    // 5. the runtime login made a member of the owner: refused (even without TEND_DB_STRICT, RLS-8)
    await admin.query(`GRANT ${owner} TO ${login}`);
    assert.match((await start()).error ?? "", /owns tables, or is a member of a role that does/);
  } finally {
    g.__tendDb = undefined;
    for (const d of started) await d.close().catch(() => {});
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
    for (const r of [login, bypass, rt, owner]) await admin.query(`DROP ROLE IF EXISTS ${r}`).catch(() => {});
    await admin.end();
  }
});

test("RLS-13 session state left by injected SQL dies with its transaction (advisory locks, read-only default, lock timeout); the self-test refuses runtime roles that can rewrite the logs", { skip }, async () => {
  const saved = process.env.TEND_CONTEXT_KEY;
  process.env.TEND_CONTEXT_KEY = randomBytes(32).toString("base64url");
  const w = await world();
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  const login = `tend_lk_${randomBytes(4).toString("hex")}`;
  let rt: DB | undefined;
  try {
    const dbName = (await w.db.get<{ d: string }>("SELECT current_database() AS d"))!.d;
    await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${login}`);
    const ownerUrl = new URL(URL_); ownerUrl.pathname = `/${dbName}`;
    const owner = await postgres(ownerUrl.toString());
    await owner.exec(runtimeGrantsSql(login));
    const u = new URL(URL_); u.pathname = `/${dbName}`; u.username = login;
    rt = await postgres(u.toString());
    await enableIsolation(rt, "unused_role_name");
    // injected into tenant A's requests, on every pooled connection: the event-order lock and the migration lock held at SESSION level,
    // every later transaction read-only by default, and a 1 ms lock timeout
    for (let i = 0; i < 8; i++) await asTenant("wa", () => rt!.tx((q) => q.exec("SELECT pg_advisory_lock(7311), pg_advisory_lock(7310); SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY; SET lock_timeout = 1")));
    const held = await admin.query(`SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE l.locktype = 'advisory' AND a.usename = '${login}'`);
    assert.equal(held.rows[0].n, 0, "no advisory lock survives the transaction that took it");
    // tenant B's writes go through at once, on whichever connection
    const t0 = Date.now();
    const b = (await withRequestContext(() => asSystem(() => agentByKey(rt!, w.B.apiKey))))!;
    await Promise.all(Array.from({ length: 8 }, (_, i) => withRequestContext(async () => { bindWorkspace("wb"); await ingestEvents(rt!, b, [{ type: "task.started", data: { taskId: `t${i}`, title: "x" } }]); })));
    assert.ok(Date.now() - t0 < 3_000, `writes were not stalled (${Date.now() - t0} ms)`);
    const settings = await asTenant("wa", () => rt!.tx((q) => q.get<{ ro: string; lt: string }>("SELECT current_setting('transaction_read_only') AS ro, current_setting('lock_timeout') AS lt")));
    assert.deepEqual(settings, { ro: "off", lt: "0" }, "session defaults are back to normal for the next request");
    // the self-test: a runtime role that may rewrite the log (here a stray grant; pg_write_all_data works the same) is refused
    await owner.exec(`GRANT UPDATE ON events TO ${login}`);
    rt.isolation!.on = false;
    await assert.rejects(enableIsolation(rt, "unused_role_name"), /may update, delete or truncate the audit log tables/);
    await owner.exec(`REVOKE UPDATE ON events FROM ${login}`);
    await admin.query(`GRANT pg_write_all_data TO ${login}`);
    await assert.rejects(enableIsolation(rt, "unused_role_name"), /may update, delete or truncate the audit log tables/);
    await admin.query(`REVOKE pg_write_all_data FROM ${login}`);
    await admin.query(`GRANT pg_read_server_files TO ${login}`);
    await assert.rejects(enableIsolation(rt, "unused_role_name"), /read or write files as the database server/);
    await admin.query(`REVOKE pg_read_server_files FROM ${login}`);
    await enableIsolation(rt, "unused_role_name");
    await owner.close();
  } finally {
    if (saved === undefined) delete process.env.TEND_CONTEXT_KEY; else process.env.TEND_CONTEXT_KEY = saved;
    await rt?.close().catch(() => {}); await w.close();
    await admin.query(`DROP OWNED BY ${login}`).catch(() => {}); await admin.query(`DROP ROLE IF EXISTS ${login}`).catch(() => {}); await admin.end();
  }
});
