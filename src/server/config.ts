import { createECDH } from "node:crypto";
import path from "node:path";

/**
 * Why an admin token is not acceptable, or undefined. The token is the only thing standing between the internet and every approval, so a production
 * build refuses a weak one: at least 32 characters with real variety (a random 24-byte base64 token has about 20 distinct characters; "aaaa…",
 * "password1234…" or a repeated short word has few). Development and tests keep the old 24-character floor so local setups do not change.
 */
export function adminTokenProblem(t: string, production = process.env.NODE_ENV === "production"): string | undefined {
  if (t.length < 24) return "shorter than 24 characters";
  if (!production) return undefined;
  if (t.length < 32) return "shorter than 32 characters";
  if (new Set(t).size < 14) return "too little variety (fewer than 14 distinct characters)";
  if (/^(.{1,8})\1+.{0,7}$/.test(t)) return "a repeated pattern";
  return undefined;
}
let warned = "";
let vapidChecked: { key: string; ok: boolean } | undefined;

/** True when the VAPID settings are usable: the public key is the private key's, and the subject is a contact. Says why once otherwise. */
function vapidOk(publicKey: string, privateKey: string, subject: string) {
  const pub = Buffer.from(publicKey, "base64url"), priv = Buffer.from(privateKey, "base64url");
  let problem = !/^(mailto:|https:\/\/)/.test(subject) ? "TEND_VAPID_SUBJECT must start with mailto: or https://"
    : pub.length !== 65 || pub[0] !== 4 ? "TEND_VAPID_PUBLIC_KEY is not an uncompressed P-256 public key" : priv.length !== 32 ? "TEND_VAPID_PRIVATE_KEY is not a P-256 private key" : "";
  if (!problem) {
    try {
      const ecdh = createECDH("prime256v1");
      ecdh.setPrivateKey(priv);
      if (!ecdh.getPublicKey().equals(pub)) problem = "TEND_VAPID_PUBLIC_KEY does not belong to TEND_VAPID_PRIVATE_KEY";
    } catch {
      problem = "TEND_VAPID_PRIVATE_KEY is not a P-256 private key";
    }
  }
  if (problem) console.error(`[tend] browser notifications are off: ${problem}.`);
  return !problem;
}

/** Server configuration, read from the environment on every access so tests can override it. */
export const config = {
  /**
   * TEND_ADMIN=0 turns the admin off without deleting anything: no admin-token sign-in (any admin session ends on its next request), the
   * /operator and /admin pages and every admin endpoint answer 404, the dashboard is never public, and a confirmed e-mail address is enough
   * to use an account (accounts.ts approves it automatically). Remove the variable to bring the admin back; nothing else changes.
   */
  get adminDisabled() {
    return process.env.TEND_ADMIN === "0";
  },
  /**
   * Browser notifications (push.ts): a VAPID key pair (base64url, as scripts/vapid-keys.mjs prints it) and a contact (mailto: or https:) for
   * push services. Missing or inconsistent: undefined, and TEND says browser notifications are not set up. The private key is never logged.
   */
  get vapid(): { publicKey: string; privateKey: string; subject: string } | undefined {
    const publicKey = process.env.TEND_VAPID_PUBLIC_KEY?.trim() ?? "", privateKey = process.env.TEND_VAPID_PRIVATE_KEY?.trim() ?? "", subject = process.env.TEND_VAPID_SUBJECT?.trim() ?? "";
    if (!publicKey || !privateKey || !subject) return undefined;
    const key = `${publicKey}|${privateKey}|${subject}`;
    if (vapidChecked?.key !== key) vapidChecked = { key, ok: vapidOk(publicKey, privateKey, subject) };
    return vapidChecked.ok ? { publicKey, privateKey, subject } : undefined;
  },
  /**
   * Whether a new account must confirm its e-mail address before it can sign in. TEND_EMAIL_VERIFICATION=0 turns that off: sign-up sends no
   * confirmation mail and an unconfirmed account can sign in. The address is still stored as not confirmed, so removing the variable makes those
   * accounts confirm it (their sessions end on the next request) instead of treating them as checked. Password reset still goes by mail.
   */
  get emailVerification() {
    return process.env.TEND_EMAIL_VERIFICATION !== "0";
  },
  /** Whether an account needs the admin's approval after confirming its address. */
  get approvalRequired() {
    return !this.adminDisabled;
  },
  /** Enables operator sign-in. A missing or weak token (see adminTokenProblem) means nobody can sign in. */
  get adminToken() {
    if (this.adminDisabled) return "";
    const t = process.env.TEND_ADMIN_TOKEN ?? "";
    const problem = t ? adminTokenProblem(t) : undefined;
    if (problem && warned !== t) {
      warned = t;
      console.error(`[tend] TEND_ADMIN_TOKEN is not acceptable (${problem}); operator sign-in is disabled. Use at least 32 random characters.`);
    }
    return t && !problem ? t : "";
  },
  /** True when a token is set but refused as weak, so sign-in can say why instead of "not configured". */
  get adminTokenWeak() {
    if (this.adminDisabled) return false;
    const t = process.env.TEND_ADMIN_TOKEN ?? "";
    return t.length > 0 && !!adminTokenProblem(t) && t.length >= 24;
  },
  /** Whether visitors can view the dashboard without signing in. Defaults to on when no admin token is set. */
  get public() {
    if (this.adminDisabled) return false;
    const v = process.env.TEND_PUBLIC;
    if (v) return v === "1" || v === "true";
    // Unset: development and tests keep the old behaviour (no admin token → a read-only look at the sample data). A production build never opens
    // the dashboard to visitors by default: a missing or weak admin token then leaves it locked, not public. Making it public is an explicit TEND_PUBLIC=1.
    return process.env.NODE_ENV === "production" ? false : !this.adminToken;
  },
  /** Run the server-side demo simulation for demo agents. */
  get demo() {
    return process.env.TEND_DEMO !== "0";
  },
  /**
   * A shared, read-only demo account (demo-account.ts): TEND_DEMO_ACCOUNT="<e-mail> <scrypt hash>", the hash as accounts.ts hashPassword() makes it, never
   * the password. Signing in with that address creates the account and its sample workspace the first time. Remove the variable to turn the
   * demo off: its sessions end on their next request and it can no longer sign in.
   */
  get demoAccount(): { email: string; hash: string } | undefined {
    const [email = "", hash = "", ...rest] = (process.env.TEND_DEMO_ACCOUNT ?? "").trim().split(/\s+/);
    return !rest.length && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && /^scrypt\$15\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/.test(hash) ? { email: email.toLowerCase(), hash } : undefined;
  },
  /** Postgres connection string. Vercel's Neon integration sets DATABASE_URL (and POSTGRES_URL). */
  get databaseUrl() {
    return process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  },
  /** Running on Vercel, where the filesystem can't hold data. */
  get onVercel() {
    return !!process.env.VERCEL;
  },
  /** Local development only: where the embedded database lives when DATABASE_URL is unset. */
  get dataDir() {
    return process.env.TEND_DATA_DIR || path.join(process.cwd(), ".data");
  },
  /**
   * Which forwarded-address header to believe. A client can send any X-Forwarded-For it likes, so by default none is trusted
   * (every caller without a known address shares one rate-limit bucket). On Vercel the platform overwrites the header, so it is
   * trusted. Behind your own reverse proxy set TEND_TRUSTED_PROXY to the number of proxies in front of Tend (usually 1).
   */
  get trustedProxy(): "platform" | number {
    const v = process.env.TEND_TRUSTED_PROXY ?? "";
    if (/^[1-9][0-9]?$/.test(v)) return Number(v);
    return process.env.VERCEL && v !== "0" ? "platform" : 0;
  },
  get secureCookies() {
    return process.env.NODE_ENV === "production";
  },
  /**
   * A server started for local use only (TEND_LOCAL_HTTP=1: the isolated test servers and a production build run on your own machine). Safari
   * refuses `Secure` cookies on plain http://, even on loopback, so a production build used that way could never keep a sign-in there.
   * Ignored on Vercel, behind a trusted proxy and whenever a database URL is set (a hosted deployment always has one, the local test servers use
   * the embedded database), so a stray flag in production does nothing. Honoured per request only for a loopback address over http (see session.ts).
   */
  /**
   * E-mail accounts (accounts.ts). Off with TEND_ACCOUNTS=0. A production server needs a mail service and its own public address, or the
   * links in verification and reset mails could not be trusted or delivered, so accounts stay off there until all three are set:
   * RESEND_API_KEY, TEND_EMAIL_FROM and TEND_APP_URL. Development (and a local-only production build) without a key writes mails to a
   * local outbox instead (email.ts).
   */
  get accounts() {
    if (process.env.TEND_ACCOUNTS === "0") return false;
    // A local-only server (localHttp: never on Vercel, never with a database URL) may use the local outbox like development does.
    return process.env.NODE_ENV !== "production" || this.localHttp || (!!this.mailKey && !!this.mailFrom && !!this.appUrl);
  },
  get mailKey() {
    return process.env.RESEND_API_KEY ?? "";
  },
  get mailFrom() {
    return process.env.TEND_EMAIL_FROM ?? "";
  },
  /** Where people open TEND, for links in mails. Never taken from a request header, which a client controls. */
  get appUrl() {
    const v = (process.env.TEND_APP_URL ?? "").replace(/\/+$/, "");
    // Verification and reset links are secrets in a mail: a production server (not a local-only one) sends them over https or not at all.
    const https = process.env.NODE_ENV === "production" && !this.localHttp;
    return (https ? /^https:\/\/[^\s/]+$/ : /^https?:\/\/[^\s/]+$/).test(v) ? v : "";
  },
  /** Who is told by mail that a new account waits for approval (optional). */
  get adminEmail() {
    return process.env.TEND_ADMIN_EMAIL ?? "";
  },
  /**
   * Authenticated requests per agent per minute (TEND_AGENT_RPM, 10–10000; default 120). One protected tool call takes four (request, token,
   * consume, report), so the default lets an agent make about 30 protected calls a minute; past it, calls are refused, never let through.
   */
  get agentRequestsPerMinute() {
    const v = Number(process.env.TEND_AGENT_RPM ?? "");
    return Number.isInteger(v) && v >= 10 && v <= 10_000 ? v : 120;
  },
  /**
   * TEND_KEY_MAX_AGE_DAYS (1–3650): every agent key issued from now on expires after at most this many days (a caller may ask for less, never
   * more). Unset: keys do not expire, as before. Keys already issued keep their (empty) expiry; rotate them to apply it.
   */
  get keyMaxAgeDays(): number | undefined {
    const v = Number(process.env.TEND_KEY_MAX_AGE_DAYS ?? "");
    return Number.isInteger(v) && v >= 1 && v <= 3650 ? v : undefined;
  },
  /**
   * Authenticated agent requests per minute for ALL agents of one workspace together (TEND_WORKSPACE_RPM, 100–100000; default 3000, which is
   * 25 agents at the default per-agent rate). Past it callers get 429 and nothing is let through.
   */
  get workspaceRequestsPerMinute() {
    const v = Number(process.env.TEND_WORKSPACE_RPM ?? "");
    return Number.isInteger(v) && v >= 100 && v <= 100_000 ? v : 3000;
  },
  /**
   * Database-enforced tenant isolation (row-level security, src/server/db-context.ts). On by default for every production server that uses
   * PostgreSQL; TEND_DB_ISOLATION=off turns it off (the application's own workspace checks remain), =on forces it everywhere PostgreSQL is used.
   * With it on, a database where it cannot be guaranteed stops the start.
   */
  get dbIsolation() {
    const v = (process.env.TEND_DB_ISOLATION ?? "").toLowerCase();
    if (v === "off" || v === "0") return false;
    if (v === "on" || v === "1") return true;
    return process.env.NODE_ENV === "production";
  },
  /**
   * Production database requirements (on by default in production, TEND_DB_STRICT=0 turns them off for local experiments): the login itself
   * cannot become the schema owner or any privileged role, the tenant context is signed (TEND_CONTEXT_KEY), and the runtime role cannot create
   * temporary tables. Checked by actual privileges at start-up (enableIsolation); a failure stops the start.
   */
  get dbStrict() {
    const v = (process.env.TEND_DB_STRICT ?? "").toLowerCase();
    if (v === "0" || v === "off") return false;
    if (v === "1" || v === "on") return true;
    return process.env.NODE_ENV === "production" && this.dbIsolation;
  },
  /** Explicit, logged exception to dbStrict for deployments that still log in as the schema owner (one DATABASE_URL). RLS is then bypassable by SQL injection. */
  get dbAllowOwnerLogin() {
    return process.env.TEND_DB_ALLOW_OWNER_LOGIN === "1";
  },
  /** The NOLOGIN role every transaction switches to when the application connects as the schema owner (TEND_DB_RUNTIME_ROLE, default tend_runtime). */
  get dbRuntimeRole() {
    return process.env.TEND_DB_RUNTIME_ROLE || "tend_runtime";
  },
  /**
   * TEND_CONTEXT_KEY: signs the tenant context of every transaction (src/server/db.ts, migration 20), so SQL injected into the application's
   * session cannot choose its own tenant. At least 32 characters of random data; keep it in the deployment's secret store. Unset: unsigned.
   * Set but too short: the start is refused (enableIsolation), never silently unsigned.
   */
  get contextKey() {
    return process.env.TEND_CONTEXT_KEY ?? "";
  },
  get localHttp() {
    // A database URL normally means a hosted deployment; a PostgreSQL on this same machine (loopback) does not.
    const localDb = (() => { try { return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(new URL(this.databaseUrl).hostname); } catch { return false; } })();
    return process.env.TEND_LOCAL_HTTP === "1" && !process.env.VERCEL && this.trustedProxy === 0 && (!this.databaseUrl || localDb);
  },
};
