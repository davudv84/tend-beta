// Postgres everywhere, so there is one SQL dialect: a hosted database in production (DATABASE_URL),
// an embedded PGlite on disk for local development, and an in-memory PGlite for tests.
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import { contextSettings } from "./db-context.ts";
import { checkTargets, probeOwner, probeRuntime } from "./deploy-check.mjs";
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
/** How far a signed context's issue time may be from its transaction's start (migration 22; superseded by migration 23's binding). */
export const CTX_WINDOW_MS = 60_000;
/** What names one transaction: the backend's pid and the transaction's start time in microseconds. tend_ctx_valid() (migration 23) compares the signed nonce with it. */
export const TX_BINDING = "pg_backend_pid()::text || '.' || (extract(epoch FROM now()) * 1000000)::bigint::text";
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
  // The hash chain links each event to the previous one in the WHOLE log. Under row-level security the inserting role sees only its tenant's
  // events, so the trigger would link to the tenant's last event and break the global chain (found by review, test RLS-7). The trigger runs with
  // its owner's rights (the owner is exempt from RLS) and a pinned search_path, so the lookup always reads the global head. It returns nothing.
  `ALTER FUNCTION events_chain() SECURITY DEFINER SET search_path = pg_catalog, public;`,
  // Signed tenant context. The policies only trust tend.workspace / tend.system when the transaction also carries a MAC over them made with a
  // context key: tend.ctx_mac = sha256(key || sha256(workspace | system | nonce)), the key named by tend.ctx_kid. The keys live in a table the
  // runtime role cannot read, and are checked by a SECURITY DEFINER function, so SQL running in the application's session (injection) can still
  // SET the settings but cannot make them valid: a forged or altered context makes every tenant row invisible (fail closed). With no key
  // installed (TEND_CONTEXT_KEY unset), the context is unsigned, as before. The outer sha256 over a fixed-length inner digest rules out length
  // extension. Only meaningful with a restricted login (DATABASE_MIGRATE_URL): an owner login can RESET ROLE past all of this.
  `CREATE TABLE tend_context_keys (kid TEXT PRIMARY KEY, secret BYTEA NOT NULL, created_at BIGINT NOT NULL);
   REVOKE ALL ON tend_context_keys FROM PUBLIC;
   CREATE FUNCTION tend_ctx_valid() RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
   DECLARE
     k BYTEA;
     ws TEXT := coalesce(current_setting('tend.workspace', true), '');
     sys TEXT := coalesce(current_setting('tend.system', true), '');
     nonce TEXT := coalesce(current_setting('tend.ctx_nonce', true), '');
     mac TEXT := coalesce(current_setting('tend.ctx_mac', true), '');
     key_id TEXT := coalesce(current_setting('tend.ctx_kid', true), '');
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM public.tend_context_keys) THEN RETURN true; END IF;
     SELECT secret INTO k FROM public.tend_context_keys WHERE kid = key_id;
     IF k IS NULL OR length(nonce) < 32 THEN RETURN false; END IF;
     RETURN mac = encode(sha256(k || sha256(convert_to(ws || '|' || sys || '|' || nonce, 'UTF8'))), 'hex');
   END $fn$;
   CREATE OR REPLACE FUNCTION tend_ws_visible(ws TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
     SELECT tend_ctx_valid() AND (current_setting('tend.system', true) = 'on' OR (ws IS NOT NULL AND ws = NULLIF(current_setting('tend.workspace', true), '')))
   $fn$;
   CREATE OR REPLACE FUNCTION tend_agent_visible(aid TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
     SELECT tend_ctx_valid() AND (current_setting('tend.system', true) = 'on'
       OR EXISTS (SELECT 1 FROM agents a WHERE a.id = aid AND a.workspace_id = NULLIF(current_setting('tend.workspace', true), '')))
   $fn$;
   CREATE OR REPLACE FUNCTION tend_user_visible(uid TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
     SELECT tend_ctx_valid() AND (current_setting('tend.system', true) = 'on'
       OR EXISTS (SELECT 1 FROM users u WHERE u.id = uid AND u.workspace_id = NULLIF(current_setting('tend.workspace', true), '')))
   $fn$;`,
  // The same policies, evaluated once per statement instead of once per row: the verified context is read through scalar subqueries (initplans)
  // and the tenant's agents/users through an uncorrelated subquery (one hashed lookup), instead of a correlated EXISTS and a signature check
  // for every row (measured: redteam/bench/rls-bench.mjs). Same meaning: system context, or the row belongs to the verified workspace.
  `CREATE FUNCTION tend_ctx_workspace() RETURNS TEXT LANGUAGE sql STABLE AS $fn$
     SELECT CASE WHEN tend_ctx_valid() THEN NULLIF(current_setting('tend.workspace', true), '') END
   $fn$;
   CREATE FUNCTION tend_ctx_system() RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
     SELECT coalesce(tend_ctx_valid() AND current_setting('tend.system', true) = 'on', false)
   $fn$;
   DROP POLICY tenant ON workspaces; CREATE POLICY tenant ON workspaces USING ((SELECT tend_ctx_system()) OR id = (SELECT tend_ctx_workspace())) WITH CHECK ((SELECT tend_ctx_system()) OR id = (SELECT tend_ctx_workspace()));
   DROP POLICY tenant ON agents; CREATE POLICY tenant ON agents USING ((SELECT tend_ctx_system()) OR workspace_id = (SELECT tend_ctx_workspace())) WITH CHECK ((SELECT tend_ctx_system()) OR workspace_id = (SELECT tend_ctx_workspace()));
   DROP POLICY tenant ON central_policies; CREATE POLICY tenant ON central_policies USING ((SELECT tend_ctx_system()) OR workspace_id = (SELECT tend_ctx_workspace())) WITH CHECK ((SELECT tend_ctx_system()) OR workspace_id = (SELECT tend_ctx_workspace()));
   DROP POLICY tenant ON users; CREATE POLICY tenant ON users USING ((SELECT tend_ctx_system()) OR workspace_id = (SELECT tend_ctx_workspace())) WITH CHECK ((SELECT tend_ctx_system()) OR workspace_id = (SELECT tend_ctx_workspace()));
   DROP POLICY tenant ON notifications; CREATE POLICY tenant ON notifications USING ((SELECT tend_ctx_system()) OR workspace_id = (SELECT tend_ctx_workspace())) WITH CHECK ((SELECT tend_ctx_system()) OR workspace_id = (SELECT tend_ctx_workspace()));
   DROP POLICY tenant ON events; CREATE POLICY tenant ON events USING ((SELECT tend_ctx_system()) OR agent_id IN (SELECT a.id FROM agents a WHERE a.workspace_id = (SELECT tend_ctx_workspace()))) WITH CHECK ((SELECT tend_ctx_system()) OR agent_id IN (SELECT a.id FROM agents a WHERE a.workspace_id = (SELECT tend_ctx_workspace())));
   DROP POLICY tenant ON reviews; CREATE POLICY tenant ON reviews USING ((SELECT tend_ctx_system()) OR agent_id IN (SELECT a.id FROM agents a WHERE a.workspace_id = (SELECT tend_ctx_workspace()))) WITH CHECK ((SELECT tend_ctx_system()) OR agent_id IN (SELECT a.id FROM agents a WHERE a.workspace_id = (SELECT tend_ctx_workspace())));
   DROP POLICY tenant ON asks; CREATE POLICY tenant ON asks USING ((SELECT tend_ctx_system()) OR agent_id IN (SELECT a.id FROM agents a WHERE a.workspace_id = (SELECT tend_ctx_workspace()))) WITH CHECK ((SELECT tend_ctx_system()) OR agent_id IN (SELECT a.id FROM agents a WHERE a.workspace_id = (SELECT tend_ctx_workspace())));
   DROP POLICY tenant ON authorizations; CREATE POLICY tenant ON authorizations USING ((SELECT tend_ctx_system()) OR agent_id IN (SELECT a.id FROM agents a WHERE a.workspace_id = (SELECT tend_ctx_workspace()))) WITH CHECK ((SELECT tend_ctx_system()) OR agent_id IN (SELECT a.id FROM agents a WHERE a.workspace_id = (SELECT tend_ctx_workspace())));
   DROP POLICY tenant ON verification_runs; CREATE POLICY tenant ON verification_runs USING ((SELECT tend_ctx_system()) OR agent_id IN (SELECT a.id FROM agents a WHERE a.workspace_id = (SELECT tend_ctx_workspace()))) WITH CHECK ((SELECT tend_ctx_system()) OR agent_id IN (SELECT a.id FROM agents a WHERE a.workspace_id = (SELECT tend_ctx_workspace())));
   DROP POLICY tenant ON operator_sessions; CREATE POLICY tenant ON operator_sessions USING ((SELECT tend_ctx_system()) OR user_id IN (SELECT u.id FROM users u WHERE u.workspace_id = (SELECT tend_ctx_workspace()))) WITH CHECK ((SELECT tend_ctx_system()) OR user_id IN (SELECT u.id FROM users u WHERE u.workspace_id = (SELECT tend_ctx_workspace())));
   DROP POLICY tenant ON auth_events; CREATE POLICY tenant ON auth_events USING ((SELECT tend_ctx_system()) OR user_id IN (SELECT u.id FROM users u WHERE u.workspace_id = (SELECT tend_ctx_workspace()))) WITH CHECK ((SELECT tend_ctx_system()) OR user_id IN (SELECT u.id FROM users u WHERE u.workspace_id = (SELECT tend_ctx_workspace())));
   DROP POLICY tenant ON user_tokens; CREATE POLICY tenant ON user_tokens USING ((SELECT tend_ctx_system()) OR user_id IN (SELECT u.id FROM users u WHERE u.workspace_id = (SELECT tend_ctx_workspace()))) WITH CHECK ((SELECT tend_ctx_system()) OR user_id IN (SELECT u.id FROM users u WHERE u.workspace_id = (SELECT tend_ctx_workspace())));
   DROP POLICY tenant ON onboarding; CREATE POLICY tenant ON onboarding USING ((SELECT tend_ctx_system()) OR user_id IN (SELECT u.id FROM users u WHERE u.workspace_id = (SELECT tend_ctx_workspace()))) WITH CHECK ((SELECT tend_ctx_system()) OR user_id IN (SELECT u.id FROM users u WHERE u.workspace_id = (SELECT tend_ctx_workspace())));
   DROP POLICY tenant ON push_subscriptions; CREATE POLICY tenant ON push_subscriptions USING ((SELECT tend_ctx_system()) OR user_id IN (SELECT u.id FROM users u WHERE u.workspace_id = (SELECT tend_ctx_workspace()))) WITH CHECK ((SELECT tend_ctx_system()) OR user_id IN (SELECT u.id FROM users u WHERE u.workspace_id = (SELECT tend_ctx_workspace())));
   DROP POLICY tenant ON notification_prefs; CREATE POLICY tenant ON notification_prefs USING ((SELECT tend_ctx_system()) OR user_id IN (SELECT u.id FROM users u WHERE u.workspace_id = (SELECT tend_ctx_workspace()))) WITH CHECK ((SELECT tend_ctx_system()) OR user_id IN (SELECT u.id FROM users u WHERE u.workspace_id = (SELECT tend_ctx_workspace())));`,
  // A signed context is valid only in a transaction that starts within CTX_WINDOW of when the server issued it: the nonce is
  // "<issued at, ms>.<32 hex>" and covered by the MAC, so settings read from one transaction (SQL injected into a system transaction) cannot
  // be replayed later. now() is the transaction's start. Within the window a replay still works; the window bounds it.
  `CREATE OR REPLACE FUNCTION tend_ctx_valid() RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
   DECLARE
     k BYTEA;
     ws TEXT := coalesce(current_setting('tend.workspace', true), '');
     sys TEXT := coalesce(current_setting('tend.system', true), '');
     nonce TEXT := coalesce(current_setting('tend.ctx_nonce', true), '');
     mac TEXT := coalesce(current_setting('tend.ctx_mac', true), '');
     key_id TEXT := coalesce(current_setting('tend.ctx_kid', true), '');
     issued NUMERIC;
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM public.tend_context_keys) THEN RETURN true; END IF;
     IF nonce !~ '^[0-9]{13}[.][0-9a-f]{32}$' THEN RETURN false; END IF;
     issued := split_part(nonce, '.', 1)::NUMERIC;
     IF abs(issued - floor(extract(epoch FROM now()) * 1000)) > ${CTX_WINDOW_MS} THEN RETURN false; END IF;
     SELECT secret INTO k FROM public.tend_context_keys WHERE kid = key_id;
     IF k IS NULL THEN RETURN false; END IF;
     RETURN mac = encode(sha256(k || sha256(convert_to(ws || '|' || sys || '|' || nonce, 'UTF8'))), 'hex');
   END $fn$;`,
  // The signed context is bound to its transaction: the nonce must be this backend's pid and this transaction's start time (TX_BINDING), which
  // the server read from the database before signing. A context read out of one transaction fails in every other one, at once: no window.
  // (Two transactions on one backend cannot start in the same microsecond: each runs BEGIN..COMMIT in between.)
  `CREATE OR REPLACE FUNCTION tend_ctx_valid() RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
   DECLARE
     k BYTEA;
     ws TEXT := coalesce(current_setting('tend.workspace', true), '');
     sys TEXT := coalesce(current_setting('tend.system', true), '');
     nonce TEXT := coalesce(current_setting('tend.ctx_nonce', true), '');
     mac TEXT := coalesce(current_setting('tend.ctx_mac', true), '');
     key_id TEXT := coalesce(current_setting('tend.ctx_kid', true), '');
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM public.tend_context_keys) THEN RETURN true; END IF;
     IF nonce <> ${TX_BINDING} THEN RETURN false; END IF;
     SELECT secret INTO k FROM public.tend_context_keys WHERE kid = key_id;
     IF k IS NULL THEN RETURN false; END IF;
     RETURN mac = encode(sha256(k || sha256(convert_to(ws || '|' || sys || '|' || nonce, 'UTF8'))), 'hex');
   END $fn$;`,
  // Workspace roles (src/server/rbac.ts): several members per workspace. Every existing account founded its workspace, so it is its owner.
  `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'operator', 'viewer'));
   ALTER TABLE users ADD COLUMN invited_by TEXT;
   ALTER TABLE users DROP CONSTRAINT users_workspace_id_key;
   CREATE INDEX users_workspace ON users(workspace_id);
   ALTER TABLE auth_events DROP CONSTRAINT auth_events_type_check;
   ALTER TABLE auth_events ADD CONSTRAINT auth_events_type_check CHECK (type IN ('signin.succeeded', 'signin.failed', 'signin.blocked', 'session.signed_out', 'session.revoked_all', 'session.rejected', 'log.suppressed', 'agentkey.rejected',
     'account.registered', 'account.verified', 'account.approved', 'account.disabled', 'account.reset_requested', 'account.password_reset',
     'member.invited', 'member.role_changed', 'member.removed'));`,
  // Two-step sign-in (TOTP, src/server/mfa.ts). The secret is encrypted by the application (TEND_MFA_KEY); one row per account.
  `CREATE TABLE user_mfa (
     user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     secret TEXT NOT NULL,
     enabled_at BIGINT,
     last_step BIGINT,
     recovery TEXT NOT NULL DEFAULT '[]',
     created_at BIGINT NOT NULL
   );
   ALTER TABLE user_mfa ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON user_mfa USING ((SELECT tend_ctx_system()) OR user_id IN (SELECT u.id FROM users u WHERE u.workspace_id = (SELECT tend_ctx_workspace()))) WITH CHECK ((SELECT tend_ctx_system()) OR user_id IN (SELECT u.id FROM users u WHERE u.workspace_id = (SELECT tend_ctx_workspace())));
   ALTER TABLE auth_events DROP CONSTRAINT auth_events_type_check;
   ALTER TABLE auth_events ADD CONSTRAINT auth_events_type_check CHECK (type IN ('signin.succeeded', 'signin.failed', 'signin.blocked', 'session.signed_out', 'session.revoked_all', 'session.rejected', 'log.suppressed', 'agentkey.rejected',
     'account.registered', 'account.verified', 'account.approved', 'account.disabled', 'account.reset_requested', 'account.password_reset',
     'member.invited', 'member.role_changed', 'member.removed', 'mfa.enabled', 'mfa.disabled'));`,
  // Invitations are records of their own (src/server/members.ts): no account exists until the invitee accepts, so an invitation can neither
  // claim an address nor, when withdrawn, block it. One-time link, stored as a hash.
  `CREATE TABLE invitations (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id),
     email TEXT NOT NULL CHECK (email = lower(email)),
     role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'viewer')),
     token_hash TEXT NOT NULL UNIQUE,
     invited_by TEXT NOT NULL,
     created_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL,
     accepted_at BIGINT,
     revoked_at BIGINT
   );
   CREATE INDEX invitations_workspace ON invitations(workspace_id);
   ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON invitations USING ((SELECT tend_ctx_system()) OR workspace_id = (SELECT tend_ctx_workspace())) WITH CHECK ((SELECT tend_ctx_system()) OR workspace_id = (SELECT tend_ctx_workspace()));
   ALTER TABLE auth_events DROP CONSTRAINT auth_events_type_check;
   ALTER TABLE auth_events ADD CONSTRAINT auth_events_type_check CHECK (type IN ('signin.succeeded', 'signin.failed', 'signin.blocked', 'session.signed_out', 'session.revoked_all', 'session.rejected', 'log.suppressed', 'agentkey.rejected',
     'account.registered', 'account.verified', 'account.approved', 'account.disabled', 'account.reset_requested', 'account.password_reset',
     'member.invited', 'member.role_changed', 'member.removed', 'member.joined', 'member.invite_revoked', 'mfa.enabled', 'mfa.disabled'));`,
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
    `REVOKE ALL ON tend_context_keys FROM ${r};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r};`,
  ].join("\n");
}

/** The context key (TEND_CONTEXT_KEY, at least 32 bytes): its id and bytes, or undefined (unsigned context). */
export function contextKey(): { kid: string; secret: Buffer } | undefined {
  const raw = config.contextKey;
  if (!raw) return undefined;
  const secret = Buffer.from(raw, "utf8");
  return { kid: createHash("sha256").update(secret).digest("hex").slice(0, 16), secret };
}
/** sha256(key || sha256(workspace | system | nonce)), as tend_ctx_valid() recomputes it. The nonce is the transaction's binding (TX_BINDING). */
export function contextSignature(workspace: string, system: string, nonce: string) {
  const k = contextKey();
  if (!k) return undefined;
  const inner = createHash("sha256").update(`${workspace}|${system}|${nonce}`, "utf8").digest();
  return { kid: k.kid, nonce, mac: createHash("sha256").update(Buffer.concat([k.secret, inner])).digest("hex") };
}
/** Installs the context key in the owner-only table (run with the schema owner's connection). Older keys stay valid until removed (rotation). */
export async function installContextKey(owner: Q) {
  const k = contextKey();
  if (k) await owner.run("INSERT INTO tend_context_keys (kid, secret, created_at) VALUES (?, ?, ?) ON CONFLICT (kid) DO NOTHING", k.kid, k.secret, Date.now());
}

/** The tables row-level security covers (migration 18). The start-up check and the tests read this list. */
export const RLS_TABLES = ["workspaces", "agents", "central_policies", "users", "notifications", "events", "reviews", "asks", "authorizations", "verification_runs",
  "operator_sessions", "auth_events", "user_tokens", "onboarding", "push_subscriptions", "notification_prefs", "user_mfa", "invitations"] as const;

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
  if (owner) await db.tx(async (q) => {
    // One instance at a time: concurrent cold starts would race on CREATE ROLE and on GRANT ("tuple concurrently updated").
    await q.get("SELECT pg_advisory_xact_lock(?)", LOCK.MIGRATE);
    await q.exec(`DO $do$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
      END IF;
    END $do$;`);
    // Membership lets this session switch to it (SET ROLE); owner-level rights stay with the login role, which the application never uses then.
    await q.exec(`GRANT "${role}" TO CURRENT_USER`);
    await q.exec(runtimeGrantsSql(role));
    await installContextKey(q);
  });
  if (owner) db.isolation.role = role;
  if (config.contextKey && config.contextKey.length < 32) throw new Error("TEND_CONTEXT_KEY must be at least 32 characters of random data");
  db.isolation.on = true;
  // Self-test, as the application will run: the effective role and the tables, read inside an isolated transaction.
  const t = await db.tx((q) => q.get<{ who: string; login: string; sup: boolean; bypass: boolean; createrole: boolean; privileged: boolean; temp: boolean; logWrite: boolean; schemaOwner: boolean; fnOwner: boolean; serverFiles: boolean; loginEscalates: boolean; owns: boolean; missing: string | null; loose: string | null }>(
    `SELECT current_user AS who, session_user AS login, r.rolsuper AS sup, r.rolbypassrls AS bypass, r.rolcreaterole AS createrole,
            -- role attributes are not inherited, but a member can SET ROLE to the role: membership in a privileged role is that privilege
            EXISTS (SELECT 1 FROM pg_roles p WHERE p.oid <> r.oid AND (p.rolsuper OR p.rolbypassrls OR p.rolcreaterole) AND pg_has_role(current_user, p.oid, 'MEMBER')) AS privileged,
            has_database_privilege(current_user, current_database(), 'TEMPORARY') AS temp,
            -- rights that defeat the guarantees without being superuser or owner: rewriting the logs (a stray grant, pg_write_all_data),
            -- owning the schema (drop others' tables) or TEND's context functions (replace them), running programs or reading files as the server
            (SELECT bool_or(has_table_privilege(current_user, 'public.' || t, 'UPDATE') OR has_table_privilege(current_user, 'public.' || t, 'DELETE') OR has_table_privilege(current_user, 'public.' || t, 'TRUNCATE'))
               FROM unnest(ARRAY['events', 'auth_events', 'verification_runs']) AS t) AS "logWrite",
            pg_has_role(current_user, (SELECT nspowner FROM pg_namespace WHERE nspname = 'public'), 'MEMBER') AS "schemaOwner",
            EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'tend\\_%' AND pg_has_role(current_user, p.proowner, 'MEMBER')) AS "fnOwner",
            EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname IN ('pg_execute_server_program', 'pg_read_server_files', 'pg_write_server_files') AND pg_has_role(current_user, p.oid, 'MEMBER')) AS "serverFiles",
            -- the LOGIN, not only the effective role: SQL in the session can RESET ROLE to it (owner login, RLS-5)
            (SELECT s.rolsuper OR s.rolbypassrls OR s.rolcreaterole FROM pg_roles s WHERE s.rolname = session_user)
              OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND pg_has_role(session_user, c.relowner, 'MEMBER'))
              OR EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname <> session_user AND (p.rolsuper OR p.rolbypassrls OR p.rolcreaterole) AND pg_has_role(session_user, p.oid, 'MEMBER')) AS "loginEscalates",
            -- owner rights also come through membership (inherited or by SET ROLE): any of that exempts from RLS or lets SQL become the owner
            EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
                     AND pg_has_role(current_user, c.relowner, 'MEMBER')) AS owns,
            (SELECT string_agg(t, ',') FROM unnest(?::text[]) AS t WHERE NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = ('public.' || t)::regclass AND c.relrowsecurity)) AS missing,
            -- every policy on a tenant table must be one of ours: a permissive USING (true) added later would quietly open the table
            (SELECT string_agg(DISTINCT p.tablename || '.' || p.policyname, ',') FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = ANY(?::text[])
                AND NOT (coalesce(p.qual, '') ~ '^\\(\\( SELECT tend_ctx_system\\(\\) AS tend_ctx_system\\) OR ' AND coalesce(p.with_check, '') = coalesce(p.qual, ''))) AS loose
       FROM pg_roles r WHERE r.rolname = current_user`, [...RLS_TABLES], [...RLS_TABLES]));
  const strict = config.dbStrict;
  const problem = !t ? "could not read the effective role" : t.sup ? `the effective role ${t.who} is a superuser` : t.bypass ? `the effective role ${t.who} has BYPASSRLS`
    : t.owns ? `the effective role ${t.who} owns tables, or is a member of a role that does (owners are exempt from row-level security)`
    : t.createrole ? `the effective role ${t.who} has CREATEROLE (it could grant itself other roles)` : t.privileged ? `the effective role ${t.who} is a member of a superuser, BYPASSRLS or CREATEROLE role`
    : t.logWrite ? `the effective role ${t.who} may update, delete or truncate the audit log tables (a stray grant or pg_write_all_data)`
    : t.schemaOwner ? `the effective role ${t.who} owns schema public, or is a member of its owner` : t.fnOwner ? `the effective role ${t.who} owns TEND's context functions (it could replace them)`
    : t.serverFiles ? `the effective role ${t.who} may run programs or read or write files as the database server`
    : t.missing ? `row-level security is off on: ${t.missing}`
    : t.loose ? `unexpected row-level security policies: ${t.loose}`
    : strict && t.loginEscalates && !config.dbAllowOwnerLogin ? `the database login ${t.login} owns the tables or can become a privileged role, so SQL injection could RESET ROLE past row-level security. In production use a restricted login (DATABASE_URL) and the owner only for migrations (DATABASE_MIGRATE_URL); see docs/database-roles.md. TEND_DB_ALLOW_OWNER_LOGIN=1 accepts the risk explicitly`
    : strict && !config.contextKey && !(config.dbAllowOwnerLogin && t.loginEscalates) ? "TEND_CONTEXT_KEY is not set: in production the tenant context must be signed"
    : strict && t.temp && !(config.dbAllowOwnerLogin && t.loginEscalates) ? `the runtime role ${t.who} can create temporary tables (run REVOKE TEMPORARY ON DATABASE <db> FROM PUBLIC as the owner; DATABASE_MIGRATE_URL start-up does it)` : "";
  // A context key installed in the database means every context must be signed with one of its keys: this server's key must be one of them,
  // or every request would see nothing. Checked through the same function the policies use.
  const signed = problem ? undefined : await db.tx((q) => q.get<{ ok: boolean }>("SELECT tend_ctx_valid() AS ok"));
  const keyProblem = problem || !signed || signed.ok ? "" : "the database holds context keys and this server's TEND_CONTEXT_KEY is not one of them (or is unset)";
  if (!problem && !keyProblem && strict && t?.loginEscalates && config.dbAllowOwnerLogin)
    console.error(`[tend] WARNING: TEND_DB_ALLOW_OWNER_LOGIN=1: the database login ${t.login} can regain owner rights, so row-level security does not stop SQL injection (docs/database-roles.md).`);
  if (problem || keyProblem) { db.isolation.on = false; throw new Error(`tenant isolation cannot be guaranteed: ${problem || keyProblem}. Fix the database roles (docs/database-roles.md) or set TEND_DB_ISOLATION=off explicitly.`); }
}

/**
 * Read-only: can the connection's LOGIN get past row-level security? A superuser, BYPASSRLS or CREATEROLE role, a member of one, a member of
 * the role that owns a table in public, or (no TEND schema yet) a login that may create tables in public and so would own them.
 */
export async function loginCanEscalate(db: DB) {
  const r = await db.get<{ name: string; escalates: boolean }>(
    `SELECT r.rolname AS name,
            r.rolsuper OR r.rolbypassrls OR r.rolcreaterole
            OR EXISTS (SELECT 1 FROM pg_roles p WHERE p.oid <> r.oid AND (p.rolsuper OR p.rolbypassrls OR p.rolcreaterole) AND pg_has_role(r.oid, p.oid, 'MEMBER'))
            OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND pg_has_role(r.oid, c.relowner, 'MEMBER'))
            OR (to_regclass('public.schema_migrations') IS NULL AND has_schema_privilege(r.oid, 'public', 'CREATE')) AS escalates
       FROM pg_roles r WHERE r.rolname = session_user`);
  return { name: r?.name ?? "unknown", escalates: r ? !!r.escalates : true };
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
    // TEND's tables with no migration history (a schema-only copy, a restore that left schema_migrations out, a database set up by hand): there
    // is no way to know which migrations those tables already carry, and replaying them fails on the first one ("relation meta already exists")
    // or, worse, half-applies. Nothing is written: the operator decides (docs/database-roles.md), never a guess made here.
    if (done.size === 0 && (await q.get<{ r: string | null }>("SELECT to_regclass('meta')::text AS r"))?.r)
      throw new Error("database_not_baselined: this database already has TEND tables (meta) but schema_migrations records no migration. Refusing to run the migrations over them and to guess which were applied. Use an empty database (for a Neon preview, a new empty database or a branch with its data) or restore the schema_migrations rows that match the schema.");
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
 * provider's integration owns and may rewrite. A missing sslmode is pinned too unless the host is this machine; an explicit `disable` is left.
 */
/**
 * What is wrong with a database URL, in words that name the variable and never its value; "" when nothing is. Run before connecting, so a
 * connection string pasted without its password (Neon's Connect dialog can hide it) is reported as that, not as the driver's
 * "SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string".
 */
export function databaseUrlProblem(name: string, url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return `${name} is not a URL`; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return `${name} does not start with postgres:// or postgresql://`;
  if (!u.username) return `${name} names no database user`;
  if (!u.password && !loopbackHost(u)) return `${name} has no password in it (copy the connection string again with the password shown)`;
  return "";
}

export function verifiedTls(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  const mode = u.searchParams.get("sslmode");
  // No sslmode at all means no TLS in pg: password and data in clear text. That is fine on this machine, never across a network, so a URL that
  // names another host is pinned too. Only an explicit sslmode=disable (an operator's deliberate choice) is left without TLS.
  if (mode === null && !loopbackHost(u)) {
    u.searchParams.set("sslmode", "verify-full");
    return u.toString();
  }
  if (!["allow", "prefer", "require", "verify-ca"].includes(mode ?? "")) return url;
  u.searchParams.set("sslmode", "verify-full");
  u.searchParams.delete("uselibpqcompat");
  return u.toString();
}
/** This machine: localhost, 127.0.0.0/8, ::1, or a Unix socket (an empty host, or a host= parameter that is a path). */
function loopbackHost(u: URL) {
  const h = decodeURIComponent(u.hostname).replace(/^\[|\]$/g, "").toLowerCase();
  const socket = u.searchParams.get("host");
  if (socket?.startsWith("/")) return true;
  return h === "" || h === "localhost" || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h);
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
  // search_path with pg_temp named LAST: otherwise the session's temporary schema is searched FIRST for tables and types, and a temp
  // table left on a pooled connection by injected SQL (e.g. a fake `agents`) would shadow the real one in later requests (RLS-11).
  // Session-level SET search_path by such SQL is overridden here, every transaction.
  const setup = (c: ReturnType<typeof contextSettings>) => `SET LOCAL search_path = public, pg_temp; ${isolation.role && !c.owner ? `SET LOCAL ROLE "${isolation.role}"; ` : ""}`;
  const settings = (c: ReturnType<typeof contextSettings>, signed?: { nonce: string; kid: string; mac: string }) => // validated identifiers and hex/digits only: safe as literals
    `SELECT set_config('tend.workspace', '${c.workspace}', true), set_config('tend.system', '${c.system}', true)`
    + (signed ? `, set_config('tend.ctx_nonce', '${signed.nonce}', true), set_config('tend.ctx_kid', '${signed.kid}', true), set_config('tend.ctx_mac', '${signed.mac}', true)` : "");
  // Session state SQL in the transaction may have left behind, removed before the connection goes back to the pool (DB-1, RLS-13): session
  // advisory locks (one on the event lock would stall every tenant's writes), and every session-level setting (read-only default, lock and
  // memory limits, search_path, tend.*). pg_temp objects cannot be created (TEMPORARY is revoked) and would be searched last anyway.
  const CLEAN = "SELECT pg_advisory_unlock_all(); RESET ALL";
  const tx: DB["tx"] = async (fn) => {
    const client = await pool.connect();
    let clean = false;
    try {
      // READ WRITE explicitly: a session default left behind (SET SESSION CHARACTERISTICS … READ ONLY) must not decide it.
      const start = `BEGIN READ WRITE; SET LOCAL statement_timeout = ${limit}; SET LOCAL idle_in_transaction_session_timeout = ${limit * 2}`;
      const c = isolation.on ? contextSettings() : undefined;
      if (!c) await client.query(start);
      else if (!contextKey()) await client.query(`${start}; ${setup(c)}${settings(c)}`);
      else {
        // Signed context bound to THIS transaction (migration 23): the database names the transaction (backend pid and start time, which
        // tend_ctx_valid() reads again), the server signs that. Settings read out of one transaction are worthless in any other. One extra round trip.
        const r = await client.query(`${start}; ${setup(c)}SELECT ${TX_BINDING} AS b`) as unknown as { rows: { b: string }[] }[];
        const binding = r[r.length - 1].rows[0].b;
        await client.query(settings(c, contextSignature(c.workspace, c.system, binding)));
      }
      const out = await fn(queries(client, (sql) => client.query(sql)));
      await client.query(`COMMIT; ${CLEAN}`);
      clean = true;
      return out;
    } catch (e) {
      await client.query(`ROLLBACK; ${CLEAN}`).then(() => { clean = true; }, () => {});
      throw e;
    } finally {
      // A connection whose session state could not be cleaned is closed, not reused (its backend ends, and with it any lock it holds).
      client.release(clean ? undefined : true);
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
  // Site-only showcase (src/lib/site-only.ts): there is no database, whatever variables are present; nothing connects.
  if (process.env.TEND_SITE_ONLY === "1") return Promise.reject(new HttpError(404, "not_found", "Not available on this site."));
  return (g.__tendDb ??= open().catch((e) => {
    g.__tendDb = undefined;
    if (/tenant isolation cannot be guaranteed/.test((e as Error).message)) void import("./security-events.ts").then((m) => m.securityEvent("isolation.failed", { reason: (e as Error).message.slice(0, 120) }));
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
  // A malformed or passwordless URL stops the start with a message that says which variable and what is wrong (no value is printed).
  for (const [name, value] of [[process.env.DATABASE_URL ? "DATABASE_URL" : "POSTGRES_URL", url], ["DATABASE_MIGRATE_URL", migrateUrl]] as const) {
    const problem = value ? databaseUrlProblem(name, value) : "";
    if (problem) throw new Error(`database configuration: ${problem}. Nothing was changed in the database.`);
  }
  // On a Vercel preview or production deployment: the URLs must match the declared targets (database, Neon branch, logins; a preview must
  // not reach the production endpoint), checked before anything connects. The build ran the same check (scripts/deploy-check.mjs); this
  // repeats it in case a variable changed after the build. src/server/deploy-check.mjs.
  const target = checkTargets(process.env);
  if (target.enforced && target.problems.length) throw new Error(`deployment check: ${target.problems.join("; ")}. Nothing was changed in the database.`);
  if (migrateUrl) {
    if (!url) throw new Error("DATABASE_MIGRATE_URL is set without DATABASE_URL");
    if (migrateUrl === url) console.error("[tend] WARNING: DATABASE_MIGRATE_URL equals DATABASE_URL, so the application still runs as the schema owner: this is not a role split.");
    const runtime = await postgres(url);
    const admin = await postgres(migrateUrl);
    try {
      // Read-only checks of both logins and of the schema state, in READ ONLY transactions, before the first write (migrations, the context
      // key, the runtime grants). Pending migrations need the deployment's explicit approval (TEND_ALLOW_MIGRATIONS=1).
      if (target.enforced) {
        const readOnly = <T>(d: DB, fn: (all: (sql: string) => Promise<Record<string, unknown>[]>) => Promise<T>) =>
          d.tx(async (q) => { await q.exec("SET TRANSACTION READ ONLY"); return fn((sql) => q.all<Record<string, unknown>>(sql)); });
        const rt = await readOnly(runtime, (all) => probeRuntime(all, target.targets));
        const ow = await readOnly(admin, (all) => probeOwner(all, target.targets, { allowMigrations: process.env.TEND_ALLOW_MIGRATIONS === "1", expectedVersion: MIGRATIONS.length }));
        const problems = [...rt.problems, ...ow.problems];
        if (problems.length) throw new Error(`deployment check: ${problems.join("; ")}. Nothing was changed in the database.`);
      }
      await migrate(admin);
      await installContextKey(admin);
      // The runtime login's privileges, renewed at every start so a release that adds a table never runs without them (or with a log table
      // that lacks its revokes). Temporary tables are revoked from PUBLIC: nothing in TEND uses them, and injected SQL could leave one behind.
      const login = (await runtime.get<{ u: string; separate: boolean }>("SELECT current_user AS u, NOT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = 'public.agents'::regclass), 'MEMBER') AS separate"))!;
      if (login.separate && /^[a-z_][a-z0-9_]{0,62}$/.test(login.u)) await admin.tx(async (q) => {
        await q.get("SELECT pg_advisory_xact_lock(?)", LOCK.MIGRATE);
        await q.exec(runtimeGrantsSql(login.u));
        await q.exec(`DO $do$ BEGIN EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()); EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO %I', current_database(), current_user); END $do$;`);
      });
    } catch (e) { await runtime.close().catch(() => {}); throw e; } finally { await admin.close().catch(() => {}); }
    try {
      await assertSchemaCurrent(runtime);
      if (config.dbIsolation) await enableIsolation(runtime);
    } catch (e) { await runtime.close().catch(() => {}); throw e; }
    return runtime;
  }
  const db = url ? await postgres(url) : await pglite(path.join(config.dataDir, "pglite"));
  // One login for everything, in production: if it is (or would become, by creating the tables) the schema owner or a privileged role, the
  // self-test after the migrations refuses it anyway. Refuse it here, BEFORE the migrations, so a misconfigured deployment changes nothing in
  // the database it was pointed at (a release once migrated production and then refused to start).
  if (url && config.dbIsolation && config.dbStrict && !config.dbAllowOwnerLogin) {
    const login = await loginCanEscalate(db).catch(async (e) => { await db.close().catch(() => {}); throw e; });
    if (login.escalates) {
      await db.close().catch(() => {});
      throw new Error(`tenant isolation cannot be guaranteed: the database login ${login.name} owns the tables or can become a privileged role (or would own the tables by creating them), so SQL injection could RESET ROLE past row-level security. Nothing was changed in the database. In production use a restricted login (DATABASE_URL) and the owner only for migrations (DATABASE_MIGRATE_URL); see docs/database-roles.md. TEND_DB_ALLOW_OWNER_LOGIN=1 accepts the risk explicitly.`);
    }
  }
  await migrate(db);
  if (url && config.dbIsolation) {
    try { await enableIsolation(db); } catch (e) { await db.close().catch(() => {}); throw e; }
  } else if (url && process.env.NODE_ENV === "production") console.error("[tend] WARNING: TEND_DB_ISOLATION=off: tenant isolation is enforced by the application only, not by the database.");
  return db;
}
