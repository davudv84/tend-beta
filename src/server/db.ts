// Postgres everywhere, so there is one SQL dialect: a hosted database in production (DATABASE_URL),
// an embedded PGlite on disk for local development, and an in-memory PGlite for tests.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import { HttpError } from "./http.ts";

/** Something to run queries against: the database, or one open transaction. `?` placeholders. */
export interface Q {
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  /** Returns the number of affected rows. */
  run(sql: string, ...params: unknown[]): Promise<number>;
  /** Several statements, no parameters. */
  exec(sql: string): Promise<void>;
  /**
   * Serialises event-writing transactions until commit, so event `seq` order is commit order and a
   * client polling `seq > n` can never skip an event that commits late. Idempotent within a transaction.
   */
  lockEvents(): Promise<void>;
}

export interface DB extends Q {
  kind: "postgres" | "pglite";
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Advisory lock keys. Lock order is always DEMO before EVENTS, so they can't deadlock. */
const LOCK = { MIGRATE: 7310, EVENTS: 7311, DEMO: 7312 } as const;
export { LOCK };

/** `?` → `$1, $2, …`. Tend's SQL never contains a literal question mark. */
const numbered = (sql: string) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

/** Append-only list of schema changes. Never edit a shipped migration; add a new one. */
export const MIGRATIONS: string[] = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE agents (
     id TEXT PRIMARY KEY,
     profile TEXT NOT NULL,
     origin TEXT NOT NULL CHECK (origin IN ('demo', 'connected')),
     status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'idle', 'paused')),
     integration_enabled INTEGER NOT NULL DEFAULT 1,
     permissions TEXT NOT NULL DEFAULT '[]',
     public INTEGER NOT NULL DEFAULT 0,
     key_hash TEXT UNIQUE,
     key_prefix TEXT,
     config_version INTEGER NOT NULL DEFAULT 1,
     acked_version INTEGER NOT NULL DEFAULT 0,
     created_at BIGINT NOT NULL,
     last_seen_at BIGINT,
     disconnected_at BIGINT
   );
   CREATE TABLE events (
     seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     id TEXT NOT NULL UNIQUE,
     agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
     type TEXT NOT NULL,
     at BIGINT NOT NULL,
     actor TEXT NOT NULL CHECK (actor IN ('agent', 'human', 'simulation', 'system')),
     data TEXT NOT NULL DEFAULT '{}',
     idempotency_key TEXT,
     UNIQUE (agent_id, idempotency_key)
   );
   CREATE INDEX events_at ON events(at);
   CREATE INDEX events_agent_seq ON events(agent_id, seq);
   CREATE TABLE reviews (
     id TEXT PRIMARY KEY,
     agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
     status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'acknowledged')),
     permission TEXT,
     decided_at BIGINT
   );
   CREATE TABLE asks (
     id TEXT PRIMARY KEY,
     agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
     requested_at BIGINT NOT NULL,
     delivered_at BIGINT,
     answered_at BIGINT
   );
   CREATE TABLE rate_limits (key TEXT NOT NULL, bucket BIGINT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (key, bucket));`,
  // Reviews of held actions can be withdrawn by the agent's runtime when it stops waiting.
  `ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_status_check;
   ALTER TABLE reviews ADD CONSTRAINT reviews_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'acknowledged', 'withdrawn'));`,
  // Pre-execution enforcement: a per-agent policy and one row per authorization. Only the sha256 of a
  // token is stored, and the CHECK means no token can exist for a pending, rejected, expired, denied or cancelled row.
  `ALTER TABLE agents ADD COLUMN enforcement TEXT NOT NULL DEFAULT 'monitor' CHECK (enforcement IN ('monitor', 'enforce'));
   ALTER TABLE agents ADD COLUMN policy TEXT NOT NULL DEFAULT '[]';
   CREATE TABLE authorizations (
     id TEXT PRIMARY KEY,
     agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
     tool TEXT NOT NULL,
     action TEXT NOT NULL,
     resource TEXT,
     detail TEXT,
     fingerprint TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'consumed', 'denied', 'cancelled')),
     reason TEXT,
     created_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL,
     decided_at BIGINT,
     approved_until BIGINT,
     token_hash TEXT UNIQUE,
     token_expires_at BIGINT,
     consumed_at BIGINT,
     mismatches INTEGER NOT NULL DEFAULT 0,
     idempotency_key TEXT,
     UNIQUE (agent_id, idempotency_key),
     CHECK (token_hash IS NULL OR status IN ('approved', 'consumed'))
   );
   CREATE INDEX authorizations_agent_status ON authorizations(agent_id, status);`,
  // History is append-only for ordinary application paths: an UPDATE, DELETE or TRUNCATE of events is refused unless the
  // transaction raised the maintenance flag (allowEventRemoval), which only the demo's retention and reset do.
  // This stops application bugs and injected statements that lack the flag. It does not stop a database owner, who can drop the trigger.
  `CREATE FUNCTION events_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
   BEGIN
     IF current_setting('tend.maintenance', true) = 'on' THEN
       IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
       RETURN NEW;
     END IF;
     RAISE EXCEPTION 'events are append-only' USING ERRCODE = '42501';
   END $fn$;
   CREATE TRIGGER events_append_only_rows BEFORE UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION events_append_only();
   CREATE TRIGGER events_append_only_truncate BEFORE TRUNCATE ON events FOR EACH STATEMENT EXECUTE FUNCTION events_append_only();`,
  // Protection check results (verification.ts): one row per run, kept as evidence, so append-only like events. The audit event
  // for each run carries only counts and who ran it; the detail lives here and is served to operators only.
  `CREATE TABLE verification_runs (
     id TEXT PRIMARY KEY,
     agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
     created_at BIGINT NOT NULL,
     created_by TEXT,
     config_version INTEGER NOT NULL,
     enforcement TEXT NOT NULL,
     duration_ms INTEGER NOT NULL,
     results TEXT NOT NULL
   );
   CREATE INDEX verification_runs_agent ON verification_runs(agent_id, created_at);
   CREATE TRIGGER verification_runs_append_only_rows BEFORE UPDATE OR DELETE ON verification_runs FOR EACH ROW EXECUTE FUNCTION events_append_only();
   CREATE TRIGGER verification_runs_append_only_truncate BEFORE TRUNCATE ON verification_runs FOR EACH STATEMENT EXECUTE FUNCTION events_append_only();`,
  // The number of reviews waiting per agent is counted on every request that can open one.
  `CREATE INDEX reviews_agent_status ON reviews(agent_id, status);`,
  // Operator sessions on the server (session.ts) and the append-only authentication log. A session row holds only the hash of
  // its secret. The log reuses the events trigger: history cannot be changed or removed unless the maintenance flag is raised.
  `CREATE TABLE operator_sessions (
     id TEXT PRIMARY KEY,
     secret_hash TEXT NOT NULL,
     epoch TEXT NOT NULL,
     created_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL,
     last_seen_at BIGINT,
     revoked_at BIGINT,
     client TEXT
   );
   CREATE INDEX operator_sessions_live ON operator_sessions(expires_at) WHERE revoked_at IS NULL;
   CREATE TABLE auth_events (
     seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     at BIGINT NOT NULL,
     type TEXT NOT NULL CHECK (type IN ('signin.succeeded', 'signin.failed', 'signin.blocked', 'session.signed_out', 'session.revoked_all', 'session.rejected', 'log.suppressed')),
     session_id TEXT,
     client TEXT,
     reason TEXT
   );
   CREATE INDEX auth_events_at ON auth_events(at);
   CREATE TRIGGER auth_events_append_only_rows BEFORE UPDATE OR DELETE ON auth_events FOR EACH ROW EXECUTE FUNCTION events_append_only();
   CREATE TRIGGER auth_events_append_only_truncate BEFORE TRUNCATE ON auth_events FOR EACH STATEMENT EXECUTE FUNCTION events_append_only();`,
  // Rejected agent keys are recorded too (R-07).
  `ALTER TABLE auth_events DROP CONSTRAINT auth_events_type_check;
   ALTER TABLE auth_events ADD CONSTRAINT auth_events_type_check CHECK (type IN ('signin.succeeded', 'signin.failed', 'signin.blocked', 'session.signed_out', 'session.revoked_all', 'session.rejected', 'log.suppressed', 'agentkey.rejected'));`,
  // Central policies: one rule set kept once and assigned to many agents. An agent's own policy still applies, but for anything a central
  // policy governs it can only be stricter (policy.ts evaluateEffective). Deleting a central policy is not supported, so the reference stays valid.
  `CREATE TABLE central_policies (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     policy TEXT NOT NULL,
     version INTEGER NOT NULL,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL,
     updated_by TEXT
   );
   ALTER TABLE agents ADD COLUMN central_policy_id TEXT REFERENCES central_policies(id);
   CREATE INDEX agents_central_policy ON agents(central_policy_id);`,
  // Accounts and workspaces (accounts.ts). Every agent and central policy belongs to one workspace; everything else hangs off an agent.
  // What existed before belongs to "default", the workspace of the admin-token operator. A user signs in with a password whose scrypt
  // hash is stored, must verify the e-mail address and be approved by the admin before a session is issued. One-time tokens (verify,
  // reset) are stored only as SHA-256 and are spent once. A session row gains the user it belongs to (NULL: an admin-token session).
  `CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at BIGINT NOT NULL);
   INSERT INTO workspaces (id, name, created_at) VALUES ('default', 'Default', 0);
   CREATE TABLE users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
     password_hash TEXT NOT NULL,
     workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id),
     created_at BIGINT NOT NULL,
     email_verified_at BIGINT,
     approved_at BIGINT,
     approved_by TEXT,
     disabled_at BIGINT,
     password_changed_at BIGINT NOT NULL
   );
   CREATE TABLE user_tokens (
     hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
     created_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL,
     used_at BIGINT
   );
   CREATE INDEX user_tokens_user ON user_tokens(user_id, purpose);
   ALTER TABLE operator_sessions ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
   CREATE INDEX operator_sessions_user ON operator_sessions(user_id);
   ALTER TABLE agents ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
   UPDATE agents SET workspace_id = 'default';
   ALTER TABLE agents ALTER COLUMN workspace_id SET NOT NULL;
   CREATE INDEX agents_workspace ON agents(workspace_id);
   ALTER TABLE central_policies ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
   UPDATE central_policies SET workspace_id = 'default';
   ALTER TABLE central_policies ALTER COLUMN workspace_id SET NOT NULL;
   ALTER TABLE central_policies DROP CONSTRAINT central_policies_name_key;
   ALTER TABLE central_policies ADD CONSTRAINT central_policies_workspace_name UNIQUE (workspace_id, name);
   ALTER TABLE auth_events ADD COLUMN user_id TEXT;
   ALTER TABLE auth_events DROP CONSTRAINT auth_events_type_check;
   ALTER TABLE auth_events ADD CONSTRAINT auth_events_type_check CHECK (type IN ('signin.succeeded', 'signin.failed', 'signin.blocked', 'session.signed_out', 'session.revoked_all', 'session.rejected', 'log.suppressed', 'agentkey.rejected',
     'account.registered', 'account.verified', 'account.approved', 'account.disabled', 'account.reset_requested', 'account.password_reset'));`,
  // Arguments an authorization is bound to (argument-aware rules, simulation). And a hash chain over the event log: each new event's hash
  // covers the previous event's hash and its own content, computed in the database for every insert path, so a changed or removed event
  // shows when the chain is checked (verifyAudit). Events from before this migration have no hash; the chain starts after them.
  `ALTER TABLE authorizations ADD COLUMN args TEXT;
   ALTER TABLE events ADD COLUMN hash TEXT;
   CREATE FUNCTION events_chain() RETURNS trigger LANGUAGE plpgsql AS $fn$
   DECLARE prev TEXT;
   BEGIN
     SELECT hash INTO prev FROM events ORDER BY seq DESC LIMIT 1;
     NEW.hash := encode(sha256(convert_to(coalesce(prev, '') || '|' || NEW.id || '|' || NEW.agent_id || '|' || NEW.type || '|' || NEW.at::text || '|' || NEW.actor || '|' || NEW.data, 'UTF8')), 'hex');
     RETURN NEW;
   END $fn$;
   CREATE TRIGGER events_chain BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION events_chain();`,
  // First-run setup (onboarding.ts): one row per account, the step it reached and the agent it set up. Completion is only recorded once the
  // server has seen the agent's test action run through the gateway; the checklist itself is always worked out from the agent's real records.
  // Notifications (notifications.ts): written in the same transaction as the event they are about, one per workspace and dedup key, so a
  // repeated event raises a count instead of a new row. Browser push subscriptions belong to one account; the endpoint is kept to deliver to it
  // and looked up by its hash. Preferences say which kinds are also sent to the browser; every kind is always listed in the app.
  `CREATE TABLE onboarding (
     user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     step TEXT NOT NULL CHECK (step IN ('welcome', 'connect', 'verify', 'policy', 'test', 'notifications', 'done')),
     integration TEXT,
     agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
     notifications TEXT CHECK (notifications IN ('enabled', 'later')),
     started_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL,
     completed_at BIGINT,
     skipped_at BIGINT
   );
   CREATE TABLE notifications (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id),
     kind TEXT NOT NULL CHECK (kind IN ('approval', 'blocked', 'alert', 'failed', 'expired', 'test')),
     agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
     subject TEXT,
     dedup_key TEXT NOT NULL,
     count INTEGER NOT NULL DEFAULT 1,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL,
     read_at BIGINT,
     resolved_at BIGINT,
     push TEXT NOT NULL DEFAULT 'none' CHECK (push IN ('none', 'queued', 'sending', 'sent', 'skipped')),
     UNIQUE (workspace_id, dedup_key)
   );
   CREATE INDEX notifications_workspace ON notifications(workspace_id, updated_at DESC);
   CREATE INDEX notifications_push_queued ON notifications(created_at) WHERE push = 'queued';
   CREATE TABLE push_subscriptions (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     endpoint_hash TEXT NOT NULL UNIQUE,
     endpoint TEXT NOT NULL,
     p256dh TEXT NOT NULL,
     auth TEXT NOT NULL,
     locale TEXT NOT NULL DEFAULT 'en',
     created_at BIGINT NOT NULL,
     last_sent_at BIGINT,
     failures INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
   CREATE TABLE notification_prefs (
     user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     approval INTEGER NOT NULL DEFAULT 1,
     blocked INTEGER NOT NULL DEFAULT 1,
     alert INTEGER NOT NULL DEFAULT 1,
     updated_at BIGINT NOT NULL
   );`,
  // A read-only account (demo-account.ts): it can sign in and look at its own workspace, and every change is refused (http.ts requireOperator).
  `ALTER TABLE users ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;`,
];

/** For the rest of this transaction, historical events may be deleted. Demo retention and reset only; never a request path. */
export const allowEventRemoval = (q: Q) => q.get("SELECT set_config('tend.maintenance', 'on', true)");

/** Applies pending migrations, one instance at a time. */
export async function migrate(db: DB) {
  await db.tx(async (q) => {
    await q.get("SELECT pg_advisory_xact_lock(?)", LOCK.MIGRATE);
    await q.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)");
    const done = new Set((await q.all<{ version: number }>("SELECT version FROM schema_migrations")).map((r) => r.version));
    for (const [i, sql] of MIGRATIONS.entries()) {
      if (done.has(i + 1)) continue;
      await q.exec(sql);
      await q.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", i + 1, Date.now());
    }
  });
}

// ---- drivers ---------------------------------------------------------------------------------

type Raw = { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null; affectedRows?: number }> };

function queries(raw: Raw, exec: (sql: string) => Promise<unknown>): Q {
  let locked = false;
  const q: Q = {
    all: async <T,>(sql: string, ...p: unknown[]) => (await raw.query(numbered(sql), p)).rows as T[],
    get: async <T,>(sql: string, ...p: unknown[]) => (await raw.query(numbered(sql), p)).rows[0] as T | undefined,
    run: async (sql, ...p) => {
      const r = await raw.query(numbered(sql), p);
      return r.rowCount ?? r.affectedRows ?? 0;
    },
    exec: async (sql) => void (await exec(sql)),
    lockEvents: async () => {
      if (locked) return;
      await raw.query("SELECT pg_advisory_xact_lock($1)", [LOCK.EVENTS]);
      locked = true;
    },
  };
  return q;
}

/**
 * The database's certificate is always checked: chain and hostname (`verify-full`). Hosted providers hand out `sslmode=require`, which pg 8
 * already treats as verify-full but pg 9 will weaken to libpq's "encrypt without checking", so it is pinned here rather than in a variable the
 * provider's integration owns and may rewrite. `disable` (a local database) and a missing sslmode are left as they are.
 */
export function verifiedTls(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  if (!["allow", "prefer", "require", "verify-ca"].includes(u.searchParams.get("sslmode") ?? "")) return url;
  u.searchParams.set("sslmode", "verify-full");
  u.searchParams.delete("uselibpqcompat");
  return u.toString();
}
export const tlsMode = (url: string) => {
  try { return new URL(verifiedTls(url)).searchParams.get("sslmode") ?? "none"; } catch { return "unknown"; }
};

export async function postgres(url: string): Promise<DB> {
  url = verifiedTls(url);
  const pg = (await import("pg")).default;
  // BIGINT columns hold millisecond timestamps and counts, all well inside Number's safe range.
  pg.types.setTypeParser(20, (v: string) => Number(v));
  // Every statement has a time limit (TEND_DB_TIMEOUT_MS, default 10 s): a stuck database answers with an error, which every protected path
  // turns into "do not act", instead of holding requests (and the event lock) until the platform kills them. Not as startup parameters:
  // PgBouncer, which Neon's pooled connections go through, refuses unknown ones and the connection would fail. So: the server-side limits are
  // set with SET LOCAL inside each transaction (fine in transaction pooling), and a client-side limit covers single queries.
  const limit = Math.min(Math.max(Number(process.env.TEND_DB_TIMEOUT_MS) || 10_000, 100), 60_000);
  const pool = new pg.Pool({ connectionString: url, max: 4, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 10_000, query_timeout: limit + 1_000 });
  pool.on("error", (e) => console.error("[tend] idle database client error", e.message));
  const base = queries(pool, (sql) => pool.query(sql));
  return {
    ...base,
    kind: "postgres",
    lockEvents: () => Promise.reject(new Error("lockEvents needs a transaction")),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL statement_timeout = ${limit}; SET LOCAL idle_in_transaction_session_timeout = ${limit * 2}`);
        const out = await fn(queries(client, (sql) => client.query(sql)));
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** Embedded Postgres. `dir` persists to disk; omit it for an in-memory database. */
export async function pglite(dir?: string): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  // PGlite creates only the last path segment; make sure the parents exist (e.g. a fresh TEND_DATA_DIR).
  if (dir) mkdirSync(path.dirname(dir), { recursive: true });
  const pg = new PGlite(dir, { parsers: { 20: (v: string) => Number(v) } });
  await pg.waitReady;
  const base = queries(pg, (sql) => pg.exec(sql));
  return {
    ...base,
    kind: "pglite",
    lockEvents: () => Promise.reject(new Error("lockEvents needs a transaction")),
    tx: (fn) => pg.transaction((t) => fn(queries(t, (sql) => t.exec(sql)))),
    close: () => pg.close(),
  };
}

/** A fresh, migrated in-memory database (tests). */
export async function memoryDb() {
  const db = await pglite();
  await migrate(db);
  return db;
}

export const meta = {
  get: async (q: Q, key: string) => (await q.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", key))?.value,
  set: (q: Q, key: string, value: string) => q.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", key, value),
};

// One pool (or embedded database) per server instance. Survives dev-server module reloads.
const g = globalThis as { __tendDb?: Promise<DB> };

export function getDb(): Promise<DB> {
  return (g.__tendDb ??= open().catch((e) => {
    g.__tendDb = undefined;
    throw e;
  }));
}

async function open() {
  const url = config.databaseUrl;
  // On Vercel the filesystem is ephemeral and shared by nothing: refuse to run without a real database.
  if (!url && config.onVercel)
    throw new HttpError(503, "database_not_configured", "No database is configured. Set DATABASE_URL to a Postgres connection string.");
  const db = url ? await postgres(url) : await pglite(path.join(config.dataDir, "pglite"));
  await migrate(db);
  return db;
}
