// Postgres everywhere, so there is one SQL dialect: a hosted database in production (DATABASE_URL),
// an embedded PGlite on disk for local development, and an in-memory PGlite for tests.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import { contextSettings } from "./db-context.ts";
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
  /** Row-level tenant isolation (PostgreSQL only): on when every statement runs as the runtime role with the request's tenant context. */
  isolation?: { on: boolean; role: string };
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
  // Mail links that sign in (accounts.ts openLink). 'signin' is a one-time sign-in link for a confirmed account. A confirmation link may
  // carry the password it will set (a scrypt hash): only for an address that was signed up more than once with different passwords.
  `ALTER TABLE user_tokens DROP CONSTRAINT user_tokens_purpose_check;
   ALTER TABLE user_tokens ADD CONSTRAINT user_tokens_purpose_check CHECK (purpose IN ('verify', 'reset', 'signin'));
   ALTER TABLE user_tokens ADD COLUMN password_hash TEXT;`,
  // Bind each event's own `seq` into the hash chain from here on, so an event's position is covered, not only its content (an interior
  // event deleted and the chain recomputed would leave a sequence gap, and the chain no longer re-links purely by content). Events already
  // hashed keep their v1 hash (no seq); the boundary below (the current highest seq) tells verifyAudit which formula to use per row, so
  // nothing already written is rewritten. events_chain is BEFORE INSERT, where NEW.seq is already assigned by the identity default.
  `INSERT INTO meta (key, value) VALUES ('events.chain.v2_after', (SELECT COALESCE(MAX(seq), 0)::text FROM events)) ON CONFLICT (key) DO NOTHING;
   CREATE OR REPLACE FUNCTION events_chain() RETURNS trigger LANGUAGE plpgsql AS $fn$
   DECLARE prev TEXT;
   BEGIN
     SELECT hash INTO prev FROM events ORDER BY seq DESC LIMIT 1;
     NEW.hash := encode(sha256(convert_to(coalesce(prev, '') || '|' || NEW.seq::text || '|' || NEW.id || '|' || NEW.agent_id || '|' || NEW.type || '|' || NEW.at::text || '|' || NEW.actor || '|' || NEW.data, 'UTF8')), 'hex');
     RETURN NEW;
   END $fn$;`,
  // Optional expiry of an agent's API key (NULL = never, as before). Set when a key is issued; checked on every request and again inside each
  // authorization transaction, so an expired key stops what it had in flight like a revoked one.
  `ALTER TABLE agents ADD COLUMN key_expires_at BIGINT;`,
  // The hash-chain boundary (which events use the seq-bound formula) is verification state: changing or deleting it would change how verifyAudit reads
  // the log. Refused outright, with no maintenance bypass. A database owner can still drop the trigger, like every trigger here.
  `CREATE FUNCTION meta_protect_chain() RETURNS trigger LANGUAGE plpgsql AS $fn$
   BEGIN RAISE EXCEPTION 'this meta key is part of the audit chain and cannot be changed' USING ERRCODE = '42501'; END $fn$;
   CREATE TRIGGER meta_protect_chain_row BEFORE UPDATE OR DELETE ON meta FOR EACH ROW WHEN (OLD.key = 'events.chain.v2_after') EXECUTE FUNCTION meta_protect_chain();`,
  // Tenant isolation in the database (row-level security). Every tenant-owned row is visible, and writable, only when the transaction's
  // tend.workspace setting names its workspace, or tend.system is on (the reviewed cross-tenant paths, src/server/db-context.ts). Not FORCEd:
  // the schema owner (migrations, maintenance, tests on the embedded database) is exempt by PostgreSQL's rules, and the application never runs
  // as the owner when isolation is on: each transaction does SET LOCAL ROLE to the runtime role, which has no BYPASSRLS (checked at start-up).
  // Not covered by RLS, on purpose: rate_limits (counters keyed by hashes and addresses, no tenant data), meta (demo state; the audit-chain
  // boundary row has its own trigger), schema_migrations (read-only to the runtime role).
  `CREATE FUNCTION tend_ws_visible(ws TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
     SELECT current_setting('tend.system', true) = 'on' OR (ws IS NOT NULL AND ws = NULLIF(current_setting('tend.workspace', true), ''))
   $fn$;
   CREATE FUNCTION tend_agent_visible(aid TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
     SELECT current_setting('tend.system', true) = 'on'
       OR EXISTS (SELECT 1 FROM agents a WHERE a.id = aid AND a.workspace_id = NULLIF(current_setting('tend.workspace', true), ''))
   $fn$;
   CREATE FUNCTION tend_user_visible(uid TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
     SELECT current_setting('tend.system', true) = 'on'
       OR EXISTS (SELECT 1 FROM users u WHERE u.id = uid AND u.workspace_id = NULLIF(current_setting('tend.workspace', true), ''))
   $fn$;
   ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON workspaces USING (tend_ws_visible(id)) WITH CHECK (tend_ws_visible(id));
   ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON agents USING (tend_ws_visible(workspace_id)) WITH CHECK (tend_ws_visible(workspace_id));
   ALTER TABLE central_policies ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON central_policies USING (tend_ws_visible(workspace_id)) WITH CHECK (tend_ws_visible(workspace_id));
   ALTER TABLE users ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON users USING (tend_ws_visible(workspace_id)) WITH CHECK (tend_ws_visible(workspace_id));
   ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON notifications USING (tend_ws_visible(workspace_id)) WITH CHECK (tend_ws_visible(workspace_id));
   ALTER TABLE events ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON events USING (tend_agent_visible(agent_id)) WITH CHECK (tend_agent_visible(agent_id));
   ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON reviews USING (tend_agent_visible(agent_id)) WITH CHECK (tend_agent_visible(agent_id));
   ALTER TABLE asks ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON asks USING (tend_agent_visible(agent_id)) WITH CHECK (tend_agent_visible(agent_id));
   ALTER TABLE authorizations ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON authorizations USING (tend_agent_visible(agent_id)) WITH CHECK (tend_agent_visible(agent_id));
   ALTER TABLE verification_runs ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON verification_runs USING (tend_agent_visible(agent_id)) WITH CHECK (tend_agent_visible(agent_id));
   ALTER TABLE operator_sessions ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON operator_sessions USING (tend_user_visible(user_id)) WITH CHECK (tend_user_visible(user_id));
   ALTER TABLE auth_events ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON auth_events USING (tend_user_visible(user_id)) WITH CHECK (tend_user_visible(user_id));
   ALTER TABLE user_tokens ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON user_tokens USING (tend_user_visible(user_id)) WITH CHECK (tend_user_visible(user_id));
   ALTER TABLE onboarding ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON onboarding USING (tend_user_visible(user_id)) WITH CHECK (tend_user_visible(user_id));
   ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON push_subscriptions USING (tend_user_visible(user_id)) WITH CHECK (tend_user_visible(user_id));
   ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON notification_prefs USING (tend_user_visible(user_id)) WITH CHECK (tend_user_visible(user_id));`,
];

/** For the rest of this transaction, historical events may be deleted. Demo retention and reset only; never a request path. */
export const allowEventRemoval = (q: Q) => q.get("SELECT set_config('tend.maintenance', 'on', true)");

/**
 * The privileges the application's own database role needs, and no more (docs/database-roles.md). Run as the schema owner, once per database, after
 * the migrations. The point is the audit log: its append-only trigger can be switched off for a transaction by anyone who can run set_config, so the
 * log is only tamper-resistant against the application role if that role holds no UPDATE, DELETE or TRUNCATE on it. (The embedded demo's retention
 * needs that privilege and so does not run under this role: a production database has no demo.) The role must be created NOSUPERUSER NOCREATEDB
 * NOCREATEROLE NOBYPASSRLS; identifiers are quoted here, never interpolated unquoted.
 */
export function runtimeGrantsSql(role: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error("role must be a lower-case identifier");
  const r = `"${role}"`;
  return [
    `GRANT USAGE ON SCHEMA public TO ${r};`,
    `REVOKE CREATE ON SCHEMA public FROM ${r};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r};`,
    `REVOKE UPDATE, DELETE, TRUNCATE ON events, auth_events, verification_runs FROM ${r};`,
    // events and verification_runs are ON DELETE CASCADE children of agents, and a cascade runs with the owner's privileges: DELETE on agents (with the
    // maintenance flag raised) would erase their history without any privilege on them. users and workspaces are the parents of those parents.
    `REVOKE DELETE, TRUNCATE ON agents, users, workspaces FROM ${r};`,
    `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_migrations FROM ${r};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r};`,
  ].join("\n");
}

/** The tables row-level security covers (migration 18). The start-up check and the tests read this list. */
export const RLS_TABLES = ["workspaces", "agents", "central_policies", "users", "notifications", "events", "reviews", "asks", "authorizations", "verification_runs",
  "operator_sessions", "auth_events", "user_tokens", "onboarding", "push_subscriptions", "notification_prefs"] as const;

/**
 * Turns tenant isolation on for a PostgreSQL pool, or refuses to start. Two cases:
 *  - the application connects as the schema owner (the default: one DATABASE_URL, as Vercel's Neon integration provides): a NOLOGIN role is
 *    created (or reused) with exactly runtimeGrantsSql's privileges, and every transaction switches to it with SET LOCAL ROLE;
 *  - it connects as a separate restricted role (DATABASE_MIGRATE_URL split): that role is used as is.
 * Either way the effective role must not be a superuser, must not have BYPASSRLS and must not own the tables, and every table in RLS_TABLES must
 * have row-level security enabled. Anything else stops the start: running "isolated" without isolation would be worse than not claiming it.
 */
export async function enableIsolation(db: DB, role = config.dbRuntimeRole) {
  if (db.kind !== "postgres" || !db.isolation) throw new Error("tenant isolation needs PostgreSQL");
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error("TEND_DB_RUNTIME_ROLE must be a lower-case identifier");
  const owner = (await db.get<{ owner: boolean }>("SELECT pg_get_userbyid(relowner) = current_user AS owner FROM pg_class WHERE oid = 'public.agents'::regclass"))?.owner;
  if (owner) {
    await db.exec(`DO $do$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
      END IF;
    END $do$;`);
    // Membership lets this session switch to it (SET ROLE); owner-level rights stay with the login role, which the application never uses then.
    await db.exec(`GRANT "${role}" TO CURRENT_USER`);
    await db.exec(runtimeGrantsSql(role));
    db.isolation.role = role;
  }
  db.isolation.on = true;
  // Self-test, as the application will run: the effective role and the tables, read inside an isolated transaction.
  const t = await db.tx((q) => q.get<{ who: string; sup: boolean; bypass: boolean; owns: boolean; missing: string | null }>(
    `SELECT current_user AS who, r.rolsuper AS sup, r.rolbypassrls AS bypass,
            EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relowner = r.oid) AS owns,
            (SELECT string_agg(t, ',') FROM unnest(?::text[]) AS t WHERE NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = ('public.' || t)::regclass AND c.relrowsecurity)) AS missing
       FROM pg_roles r WHERE r.rolname = current_user`, [...RLS_TABLES]));
  const problem = !t ? "could not read the effective role" : t.sup ? `the effective role ${t.who} is a superuser` : t.bypass ? `the effective role ${t.who} has BYPASSRLS`
    : t.owns ? `the effective role ${t.who} owns tables (owners are exempt from row-level security)` : t.missing ? `row-level security is off on: ${t.missing}` : "";
  if (problem) { db.isolation.on = false; throw new Error(`tenant isolation cannot be guaranteed: ${problem}. Fix the database roles (docs/database-roles.md) or set TEND_DB_ISOLATION=off explicitly.`); }
}

/** Fails unless every migration this code knows has been applied (a newer schema is allowed: rolling deploys): the application role must not run on an older one. It checks versions, not privileges. */
export async function assertSchemaCurrent(db: DB) {
  const rows = await db.all<{ version: number }>("SELECT version FROM schema_migrations");
  const have = new Set(rows.map((r) => Number(r.version)));
  const missing = MIGRATIONS.map((_, i) => i + 1).filter((v) => !have.has(v));
  if (missing.length) throw new Error(`database schema is out of date (missing migrations ${missing.join(", ")}); run it with DATABASE_MIGRATE_URL or apply them as the schema owner`);
}

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
  // Tenant isolation (enableIsolation): each transaction starts as the runtime role with the request's tenant context, all with SET LOCAL, so it ends
  // with the transaction: nothing survives on the pooled connection (and PgBouncer's transaction pooling, which Neon uses, stays safe).
  const isolation = { on: false, role: "" };
  const preamble = () => {
    const c = contextSettings(); // validated identifiers, safe as literals
    return `${isolation.role ? `SET LOCAL ROLE "${isolation.role}"; ` : ""}SELECT set_config('tend.workspace', '${c.workspace}', true), set_config('tend.system', '${c.system}', true)`;
  };
  const tx: DB["tx"] = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query(`BEGIN; SET LOCAL statement_timeout = ${limit}; SET LOCAL idle_in_transaction_session_timeout = ${limit * 2}${isolation.on ? `; ${preamble()}` : ""}`);
      const out = await fn(queries(client, (sql) => client.query(sql)));
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  };
  // With isolation on, a statement outside a transaction becomes a transaction of its own, so it too carries the role and the context.
  type Fn = (...x: unknown[]) => Promise<unknown>;
  const one = <K extends "get" | "all" | "run" | "exec">(k: K) => ((...a: unknown[]) => (isolation.on ? tx((q) => (q[k] as unknown as Fn)(...a)) : (base[k] as unknown as Fn)(...a))) as unknown as Q[K];
  return {
    ...base,
    get: one("get"), all: one("all"), run: one("run"), exec: one("exec"),
    kind: "postgres",
    isolation,
    lockEvents: () => Promise.reject(new Error("lockEvents needs a transaction")),
    tx,
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
  if (!url && process.env.NODE_ENV === "production" && !config.localHttp)
    console.error("[tend] WARNING: production build without DATABASE_URL: using the embedded single-process database in " + config.dataDir + ". Two instances would not share data and a container restart may lose it. Set DATABASE_URL.");
  // Least privilege (optional): DATABASE_MIGRATE_URL is a role that may change the schema; DATABASE_URL then only needs to read and write rows.
  // Migrations run on a separate short-lived connection with the first, the pool the application uses is the second, and it must find the schema
  // already current: an outdated or unreadable schema stops the start instead of running with it. Without DATABASE_MIGRATE_URL both are one role, as before.
  const migrateUrl = process.env.DATABASE_MIGRATE_URL ?? "";
  if (migrateUrl) {
    if (!url) throw new Error("DATABASE_MIGRATE_URL is set without DATABASE_URL");
    if (migrateUrl === url) console.error("[tend] WARNING: DATABASE_MIGRATE_URL equals DATABASE_URL, so the application still runs as the schema owner: this is not a role split.");
    const admin = await postgres(migrateUrl);
    try { await migrate(admin); } finally { await admin.close().catch(() => {}); }
    const runtime = await postgres(url);
    try {
      await assertSchemaCurrent(runtime);
      if (config.dbIsolation) await enableIsolation(runtime);
    } catch (e) { await runtime.close().catch(() => {}); throw e; }
    return runtime;
  }
  const db = url ? await postgres(url) : await pglite(path.join(config.dataDir, "pglite"));
  await migrate(db);
  if (url && config.dbIsolation) {
    try { await enableIsolation(db); } catch (e) { await db.close().catch(() => {}); throw e; }
  } else if (url && process.env.NODE_ENV === "production") console.error("[tend] WARNING: TEND_DB_ISOLATION=off: tenant isolation is enforced by the application only, not by the database.");
  return db;
}
