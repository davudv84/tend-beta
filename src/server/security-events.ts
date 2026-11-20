// Security monitoring: one structured, redacted log line per security event, alert rules over short windows, and optional delivery of alerts to
// a webhook (TEND_ALERT_WEBHOOK_URL). What it records: kinds, counts, coarse identifiers (hashed). What it never records: passwords, tokens, keys,
// cookies, e-mail addresses in clear, request bodies, IP addresses beyond a /24 (/48 for IPv6).
//
// Log line:  {"tend":"security","kind":"signin.failed","severity":"low","at":…,"fields":{…}}
// Alert:     {"tend":"alert","rule":"auth_failures","severity":"high","count":25,"windowSeconds":300,"summary":"…","at":…}
//
// Counters live in this server process. On a serverless platform each instance counts on its own, so thresholds are per instance: a
// distributed attack spread over many instances may stay under them. Forward the log lines to a log platform and alert there too
// (docs/monitoring.md). Delivery of alerts is best effort and never delays or fails the request that caused them.
import { createHash } from "node:crypto";
import { config } from "./config.ts";

export type Severity = "info" | "low" | "medium" | "high" | "critical";
export interface Alert { rule: string; severity: Severity; count: number; windowSeconds: number; summary: string; at: number }

/** Each rule: which kinds it counts, over what window, how many make an alert, and per what (one counter per key). */
interface Rule { rule: string; kinds: string[]; windowSeconds: number; threshold: number; severity: Severity; key?: (f: Fields) => string; summary: (n: number) => string }
export const RULES: Rule[] = [
  { rule: "auth_failures", kinds: ["signin.failed", "signin.blocked"], windowSeconds: 300, threshold: 25, severity: "high", summary: (n) => `${n} failed or blocked sign-ins in 5 minutes on one server instance` },
  { rule: "auth_failures_account", kinds: ["signin.failed"], windowSeconds: 900, threshold: 10, severity: "medium", key: (f) => String(f.account ?? ""), summary: (n) => `${n} failed sign-ins for one account in 15 minutes` },
  { rule: "mfa_failures", kinds: ["mfa.failed"], windowSeconds: 900, threshold: 5, severity: "high", key: (f) => String(f.account ?? ""), summary: (n) => `${n} wrong second-factor codes after a correct password for one account in 15 minutes (the password may be known)` },
  { rule: "suspicious_api_keys", kinds: ["agentkey.rejected"], windowSeconds: 300, threshold: 50, severity: "medium", summary: (n) => `${n} requests with unknown or revoked agent keys in 5 minutes` },
  { rule: "repeated_denials", kinds: ["authz.denied"], windowSeconds: 300, threshold: 30, severity: "medium", key: (f) => String(f.session ?? f.client ?? ""), summary: (n) => `${n} refused operator requests from one session or address in 5 minutes (probing for other tenants' ids or for rights it lacks)` },
  { rule: "tenant_isolation_failure", kinds: ["isolation.failed"], windowSeconds: 3600, threshold: 1, severity: "critical", summary: () => "Database tenant isolation could not be guaranteed at start-up; the server refused to start" },
  { rule: "audit_integrity", kinds: ["audit.failed"], windowSeconds: 3600, threshold: 1, severity: "critical", summary: () => "The audit log hash chain did not verify" },
  { rule: "enforcement_error", kinds: ["enforcement.error"], windowSeconds: 300, threshold: 3, severity: "high", summary: (n) => `${n} server errors on authorization or gateway routes in 5 minutes (agents fail closed: their actions are refused)` },
  { rule: "privilege_change", kinds: ["member.role_changed", "member.invited", "mfa.disabled", "key.revoked", "policy.updated", "policy.central_updated", "policy.central_unassigned"], windowSeconds: 600, threshold: 20, severity: "medium", key: (f) => String(f.workspace ?? ""), summary: (n) => `${n} security-relevant configuration changes in one workspace in 10 minutes` },
];
/** Kinds that are always written as an event line even when no rule counts them (security-relevant configuration). */
const SEVERITY: Record<string, Severity> = {
  "signin.failed": "low", "signin.blocked": "medium", "mfa.failed": "medium", "agentkey.rejected": "low", "authz.denied": "low", "isolation.failed": "critical", "audit.failed": "critical",
  "enforcement.error": "high", "member.role_changed": "medium", "member.invited": "low", "member.removed": "low", "mfa.enabled": "info", "mfa.disabled": "medium",
  "key.revoked": "low", "key.rotated": "info", "policy.updated": "low", "policy.central_updated": "low", "policy.central_assigned": "low", "policy.central_unassigned": "low",
  "account.disabled": "medium", "session.revoked_all": "info", "audit.ok": "info",
};

type Fields = Record<string, string | number | boolean | undefined>;
/** Values that could identify a person or unlock something are hashed (8 hex), addresses cut to their network, anything else bounded. */
const SENSITIVE = /pass|secret|token|key|cookie|authorization|mac|nonce|code/i;
const IDENTIFYING = /^(email|account|user|session)$/i;
const short = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 8);
export function redact(f: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined) continue;
    if (SENSITIVE.test(k)) continue; // never logged, not even hashed
    if (typeof v !== "string") { out[k] = v; continue; }
    if (IDENTIFYING.test(k) || v.includes("@")) { out[k] = `h:${short(v.toLowerCase())}`; continue; }
    if (k === "client") { out[k] = v.includes(":") ? v.split(":").slice(0, 3).join(":") + "::/48" : v.split(".").slice(0, 3).join(".") + ".0/24"; continue; }
    out[k] = v.replace(/tend_sk_[A-Za-z0-9_-]+/g, "tend_sk_…").slice(0, 120);
  }
  return out;
}

interface State { hits: Map<string, number[]>; lastAlert: Map<string, number>; sink?: (line: string) => void; deliver?: (a: Alert) => Promise<void> }
const g = globalThis as { __tendSec?: State };
const state: State = (g.__tendSec ??= { hits: new Map(), lastAlert: new Map() });
/** Tests: capture log lines and deliveries instead of writing them. */
export function _testHooks(h: { sink?: (line: string) => void; deliver?: (a: Alert) => Promise<void> } | null) {
  state.sink = h?.sink; state.deliver = h?.deliver; state.hits.clear(); state.lastAlert.clear();
}
const write = (o: unknown) => { const line = JSON.stringify(o); if (state.sink) state.sink(line); else console.warn(line); };
/** One alert per rule (and key) per 15 minutes: a sustained attack is one page, not hundreds. */
const ALERT_EVERY = 15 * 60_000;

/** Records a security event. Never throws. Returns the alerts it raised (for tests). */
export function securityEvent(kind: string, fields: Fields = {}, now = Date.now()): Alert[] {
  const raised: Alert[] = [];
  try {
    write({ tend: "security", kind, severity: SEVERITY[kind] ?? "info", at: now, fields: redact(fields) });
    for (const r of RULES) {
      if (!r.kinds.includes(kind)) continue;
      if (r.key && !r.key(fields)) continue; // a per-account (or per-session) rule needs that key: unknown ones are not lumped together
      const id = `${r.rule}|${r.key ? short(r.key(fields)) : ""}`;
      const since = now - r.windowSeconds * 1000;
      const list = (state.hits.get(id) ?? []).filter((t) => t > since);
      list.push(now);
      state.hits.set(id, list.slice(-1000));
      if (list.length < r.threshold || now - (state.lastAlert.get(id) ?? 0) < ALERT_EVERY) continue;
      state.lastAlert.set(id, now);
      const alert: Alert = { rule: r.rule, severity: r.severity, count: list.length, windowSeconds: r.windowSeconds, summary: r.summary(list.length), at: now };
      write({ tend: "alert", ...alert });
      raised.push(alert);
      void (state.deliver ?? deliverAlert)(alert).catch(() => {});
    }
    if (state.hits.size > 10_000) state.hits.clear(); // bounded memory under a flood of distinct keys
  } catch { /* monitoring must never break a request */ }
  return raised;
}

/** POSTs an alert to TEND_ALERT_WEBHOOK_URL (HTTPS required in production). The body is the alert only: no customer data. */
export async function deliverAlert(a: Alert, url = config.alertWebhookUrl) {
  if (!url) return;
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "TEND-alerts" }, body: JSON.stringify({ source: "tend", ...a, service: config.appUrl ? new URL(config.appUrl).host : undefined }), signal: AbortSignal.timeout(5_000) });
  if (!r.ok) write({ tend: "security", kind: "alert.delivery_failed", severity: "medium", at: Date.now(), fields: { rule: a.rule, status: r.status } });
}
