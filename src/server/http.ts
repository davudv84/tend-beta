import { isIP } from "node:net";
import { currentSession, type Session } from "./session.ts";
import { config } from "./config.ts";
import type { Q } from "./db.ts";
import { spend } from "./limits.ts";

export { spend };

export class HttpError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });

/** Wraps a route handler: known errors become JSON, unknown ones are logged and hidden. */
export function route<C>(fn: (req: Request, ctx: C) => Promise<Response> | Response) {
  return async (req: Request, ctx: C) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message, ...e.extra }, e.status, e.status === 429 ? { "retry-after": String(e.extra?.retryAfter ?? 10) } : {});
      console.error("[tend] unhandled error", e);
      return json({ error: "internal_error", message: "Something went wrong on the server." }, 500);
    }
  };
}

export async function readJson(req: Request, max = 64_000): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max) throw new HttpError(413, "payload_too_large", `Request bodies are limited to ${max} bytes.`);
  // Read as a stream and stop at the limit: a body sent in chunks has no declared length to check up front.
  let text = "";
  if (req.body) {
    const reader = req.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) {
        await reader.cancel();
        throw new HttpError(413, "payload_too_large", `Request bodies are limited to ${max} bytes.`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

// ---- rate limiting ---------------------------------------------------------------------------
// A fixed window counted in the database, so every server instance enforces the same limit. The counter is one atomic upsert:
// of any number of parallel callers, exactly `max` units are admitted, never more.

export async function limit(q: Q, key: string, perMinute: number) {
  if (!(await spend(q, key, perMinute)).ok) throw new HttpError(429, "rate_limited", "Too many requests. Slow down and retry shortly.");
}

/** An IPv4 address as is; an IPv6 address as its /64, because one subscriber controls a whole /64 and could otherwise rotate through it. */
function normalize(raw: string) {
  const v = raw.trim().replace(/^\[|\]$/g, "").replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, "$1");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v);
  if (mapped) return normalize(mapped[1]);
  const kind = isIP(v);
  if (kind === 4) return v;
  if (kind !== 6) return undefined;
  const [head, tail = ""] = v.toLowerCase().split("::");
  const groups = head.split(":").filter(Boolean);
  const rest = tail.split(":").filter(Boolean);
  const all = v.includes("::") ? [...groups, ...Array(8 - groups.length - rest.length).fill("0"), ...rest] : groups;
  return `${all.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

let warned = false;

/**
 * The caller's address for rate limiting, or "unknown" when it cannot be established. Forwarded headers are client input
 * unless a trusted proxy wrote them (config.trustedProxy): untrusted ones are ignored, never used to pick a bucket, so
 * rotating the header gains nothing and one address cannot be locked out by someone else's requests.
 */
export function clientIp(req: Request): string {
  const trust = config.trustedProxy;
  const xff = req.headers.get("x-forwarded-for");
  if (trust === 0) {
    if (xff && !warned) {
      warned = true;
      console.warn("[tend] X-Forwarded-For is being ignored because no trusted proxy is configured. Behind a reverse proxy, set TEND_TRUSTED_PROXY to the number of proxies in front of Tend.");
    }
    return "unknown";
  }
  const hops = (xff ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  // Each trusted proxy appends the address it saw, so the client is as many entries from the right as there are proxies.
  const raw = trust === "platform" ? req.headers.get("x-real-ip") ?? hops.at(-1) : hops.at(-trust);
  return (raw && normalize(raw)) || "unknown";
}

/** Refuses a request another site made the browser send (CSRF defence in depth). Typed or scripted requests carry no site and pass. */
export function requireSameSite(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let from = "";
  try {
    from = origin ? new URL(origin).host : "";
  } catch {}
  if (origin && host && from !== host) throw new HttpError(403, "bad_origin", "Cross-site requests are not allowed.");
  // Browsers say where a request came from; anything but this site (or no site at all, as when typed or scripted) is refused.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "bad_origin", "Cross-site requests are not allowed.");
}

/**
 * Operator-only: a valid session, and the request must come from this site. The session is looked up on the server on every call, so a
 * revoked one stops working at once. Returns the session: `id` is recorded with what the operator did, and `workspace` bounds what the
 * route may read or change (an id from another workspace must be answered as not found). Always `await` it: an unawaited call checks nothing.
 */
export async function requireOperator(req: Request, db: Q): Promise<Session> {
  requireSameSite(req);
  const s = await currentSession(db, req);
  if (!s) throw new HttpError(403, "operator_required", "Sign in to make changes. Visitors have read-only access.");
  return s;
}

/** The admin token's session only: approving accounts, the demo. */
export async function requireAdmin(req: Request, db: Q): Promise<Session> {
  const s = await requireOperator(req, db);
  if (!s.admin) throw new HttpError(403, "admin_required", "Only the admin can do this.");
  return s;
}
