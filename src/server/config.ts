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
    return v ? v === "1" || v === "true" : !this.adminToken;
  },
  /** Run the server-side demo simulation for demo agents. */
  get demo() {
    return process.env.TEND_DEMO !== "0";
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
    return /^https?:\/\/[^\s/]+$/.test(v) ? v : "";
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
  get localHttp() {
    return process.env.TEND_LOCAL_HTTP === "1" && !process.env.VERCEL && this.trustedProxy === 0 && !this.databaseUrl;
  },
};
