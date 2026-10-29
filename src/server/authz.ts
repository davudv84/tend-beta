// Pre-execution authorization. Two ways to the same guarantees:
//   one round trip   POST /authorize: allowed by policy → authorized and spent in one transaction; needs a person → pending, and once
//                    approved POST /authorizations/{id}/spend spends it (agent key + exact request + atomic status change, no token).
//   token flow       request → (human approval) → claim a token → consume it right before acting (the server-side gateway uses this).
// "Consumed" means Tend authorized the action once. It is not proof the action ran: that is only ever
// shown by the tool.called event the agent reports afterwards.
//
// Rules this file keeps:
//  - Policy, permissions and agent state are read from the database, never from the request.
//  - A token exists only for an approved, unexpired row (the schema CHECK backs this up) and only its
//    sha256 is stored. Tokens never go into events, errors or logs.
//  - Consuming is one UPDATE that checks token, expiry and the bound fingerprint together, so of any
//    number of concurrent or repeated attempts at most one wins.
//  - Every failure is a non-2xx response. A refusal that must leave a trace (alerts, counters) is
//    returned from the transaction and thrown after it commits, so it is not rolled back.
import { randomBytes, randomUUID } from "node:crypto";
import type { Agent } from "../lib/types";
import { hashKey } from "./auth.ts";
import type { DB, Q } from "./db.ts";
import { HttpError } from "./http.ts";
import { evaluateEffective, fingerprint, ID, parseAuthRequest, type AuthRequest } from "./policy.ts";
import { agentBudget, agentRow, centralOf, insertEvent, toAgent } from "./repo.ts";

export const TTL = { request: 10 * 60_000, approval: 5 * 60_000, token: 60_000 };
export const MAX_PENDING = 20;
export const MISMATCH_LIMIT = 3;
const TOKEN = /^tend_az_[A-Za-z0-9_-]{43}$/;

type Status = "pending" | "approved" | "rejected" | "expired" | "consumed" | "denied" | "cancelled";
interface Row {
  id: string; agent_id: string; tool: string; action: string; resource: string | null; detail: string | null; fingerprint: string;
  status: Status; reason: string | null; created_at: number; expires_at: number; decided_at: number | null; approved_until: number | null;
  token_hash: string | null; token_expires_at: number | null; consumed_at: number | null; mismatches: number; args: string | null;
}

const newToken = () => `tend_az_${randomBytes(32).toString("base64url")}`;
const asRequest = (r: Row): AuthRequest => ({ tool: r.tool, action: r.action, resource: r.resource, detail: r.detail, args: r.args ? JSON.parse(r.args) : null });
const bound = (r: Pick<AuthRequest, "tool" | "action" | "resource" | "detail">) => ({ tool: r.tool, action: r.action, ...(r.resource && { resource: r.resource }), ...(r.detail && { detail: r.detail }) });

/** What an agent may see about an authorization. Never the fingerprint or token hash. */
const view = (r: Row) => ({
  id: r.id, status: r.status, tool: r.tool, action: r.action, resource: r.resource, detail: r.detail, ...(r.reason && { reason: r.reason }),
  createdAt: r.created_at, expiresAt: r.status === "approved" ? r.approved_until : r.expires_at,
});

async function mine(q: Q, agentId: string, id: string) {
  // Scoped to the caller: another agent's id looks the same as an id that doesn't exist.
  const row = await q.get<Row>("SELECT * FROM authorizations WHERE id = ? AND agent_id = ?", id, agentId);
  if (!row) throw new HttpError(404, "authorization_not_found", "No authorization with that id.");
  return row;
}

/**
 * Re-checked at claim and consume, so pausing the agent or tightening its policy takes effect on tokens already handed out.
 * That includes allow → approve: an authorization the policy granted on its own was never seen by a person, so it stops too.
 */
async function stillPermitted(q: Q, row: Row) {
  const a = await agentRow(q, row.agent_id);
  if (!a) return { effect: "deny" as const, reason: "unknown_agent" };
  const d = evaluateEffective(toAgent(a), a.policy, (await centralOf(q, a))?.policy, asRequest(row));
  return d.effect === "approve" && row.reason === "policy_allowed" ? { effect: "deny" as const, reason: "approval_required" } : d;
}

/** Requests nobody decided in time, and approvals nobody used in time, end here: no token survives and the review leaves the queue. */
export async function expireStale(q: Q, now: number) {
  const rows = await q.all<{ id: string; agent_id: string }>(
    "UPDATE authorizations SET status = 'expired', token_hash = NULL WHERE (status = 'pending' AND expires_at <= ?) OR (status = 'approved' AND approved_until <= ?) RETURNING id, agent_id", now, now);
  for (const r of rows) {
    if (await q.run("UPDATE reviews SET status = 'withdrawn', decided_at = ? WHERE id = ? AND status = 'pending'", now, r.id))
      await insertEvent(q, { agentId: r.agent_id, type: "review.withdrawn", actor: "system", at: now, data: { reviewId: r.id, reason: "expired" } });
    await insertEvent(q, { agentId: r.agent_id, type: "authorization.expired", actor: "system", at: now, data: { authorizationId: r.id } });
  }
}

/** Read paths only take the write lock when something has actually expired. */
export async function sweepExpired(db: DB, now: number) {
  if (await db.get("SELECT 1 FROM authorizations WHERE (status = 'pending' AND expires_at <= ?) OR (status = 'approved' AND approved_until <= ?) LIMIT 1", now, now))
    await db.tx(async (q) => {
      await q.lockEvents();
      await expireStale(q, now);
    });
}

/** Asks to do something sensitive. Denials are stored too (they are part of the audit trail) and answered with 403. */
export async function requestAuthorization(db: DB, agent: Agent, body: unknown, idemKey: string | null, now = Date.now(), { spend = false } = {}) {
  const parsed = parseAuthRequest(body);
  if (!parsed.ok) throw new HttpError(422, "invalid_request", "The authorization request did not validate.", { errors: parsed.errors });
  if (idemKey !== null && !ID.test(idemKey)) throw new HttpError(422, "invalid_idempotency_key", "Idempotency-Key must be 1–64 characters of letters, digits, _ . : -");
  const r = parsed.request, fp = fingerprint(agent.id, r);
  await sweepExpired(db, now); // committed on its own: the checks below may throw and roll their transaction back
  await agentBudget(db, agent.id, "authorizations"); // denials are stored too, so they count: a refused flood must not fill the table
  return db.tx(async (q) => {
    await q.lockEvents();
    await expireStale(q, now);
    const a = await agentRow(q, agent.id);
    if (!a) throw new HttpError(401, "invalid_key", "Unknown or revoked API key.");
    if (idemKey) {
      const prior = await q.get<Row>("SELECT * FROM authorizations WHERE agent_id = ? AND idempotency_key = ?", agent.id, idemKey);
      if (prior) {
        if (prior.fingerprint !== fp) throw new HttpError(409, "idempotency_conflict", "That Idempotency-Key was already used for a different request.");
        // Already spent: whether the first answer arrived or not, the action may already have run. Never authorize it twice.
        if (spend && prior.status === "consumed") throw new HttpError(409, "already_consumed", "This request was already authorized and spent. Ask again with a new key if it must run again.");
        return { view: view(prior), created: false };
      }
    }
    if ((await q.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM authorizations WHERE agent_id = ? AND status = 'pending'", agent.id))!.n >= MAX_PENDING)
      throw new HttpError(429, "too_many_pending", `At most ${MAX_PENDING} requests can wait for approval at once.`);

    // Read in the same transaction (under the events lock) as the agent row, so a central change is either wholly before or wholly after.
    const central = await centralOf(q, a);
    const d = evaluateEffective(toAgent(a), a.policy, central?.policy, r);
    const source = d.source === "central" && central ? { policySource: "central", centralPolicyId: central.id, centralVersion: central.version } : {};
    // With spend, an action the policy allows is authorized and spent in this one transaction: there is no token to lose or replay.
    const status: Status = d.effect === "allow" ? (spend ? "consumed" : "approved") : d.effect === "approve" ? "pending" : "denied";
    const id = `az_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
    await q.run(
      `INSERT INTO authorizations (id, agent_id, tool, action, resource, detail, fingerprint, status, reason, created_at, expires_at, decided_at, approved_until, idempotency_key, args, consumed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, agent.id, r.tool, r.action, r.resource, r.detail, fp, status, d.reason, now,
      status === "pending" ? now + TTL.request : status === "approved" ? now + TTL.approval : now,
      status === "pending" ? null : now, status === "approved" ? now + TTL.approval : null, idemKey, r.args ? JSON.stringify(r.args) : null, status === "consumed" ? now : null);
    // A human reviews it in the existing queue; the review id is the authorization id.
    if (status === "pending") await q.run("INSERT INTO reviews (id, agent_id, status) VALUES (?, ?, 'pending')", id, agent.id);
    const stored = (await q.get<Row>("SELECT * FROM authorizations WHERE id = ?", id))!;
    await insertEvent(q, status === "denied"
      ? { agentId: agent.id, type: "authorization.denied", actor: "system", at: now, data: { authorizationId: id, ...bound(r), reason: d.reason, ...source } }
      : { agentId: agent.id, type: "authorization.requested", actor: "agent", at: now, data: { authorizationId: id, ...bound(r), status: status === "consumed" ? "approved" : status, reason: d.reason, approval: status === "pending", expiresAt: view(stored).expiresAt, ...source } });
    if (status === "consumed") await insertEvent(q, { agentId: agent.id, type: "authorization.consumed", actor: "system", at: now, data: { authorizationId: id, ...bound(r) } });
    return { view: view(stored), created: true };
  });
}

/** Status only: no token is ever returned here. */
export async function authorizationStatus(db: DB, agent: Agent, id: string, now = Date.now()) {
  await sweepExpired(db, now);
  return view(await mine(db, agent.id, id));
}

/**
 * Hands out a token for an approved authorization. Repeating the call issues a new token and the old
 * one stops working, so a lost response can be retried and there is never more than one live token.
 */
export async function claimToken(db: DB, agent: Agent, id: string, now = Date.now()) {
  await sweepExpired(db, now);
  return db.tx(async (q) => {
    await q.lockEvents();
    await expireStale(q, now);
    const row = await mine(q, agent.id, id);
    if (row.status === "pending") return { view: view(row) };
    if (row.status !== "approved") throw new HttpError(403, "not_approved", `This authorization is ${row.status}; no token can be issued.`, { status: row.status });
    const d = await stillPermitted(q, row);
    if (d.effect === "deny") throw new HttpError(403, "not_permitted", "The agent is no longer allowed to do this.", { reason: d.reason });
    const token = newToken();
    const tokenExpiresAt = Math.min(now + TTL.token, row.approved_until!);
    const n = await q.run("UPDATE authorizations SET token_hash = ?, token_expires_at = ? WHERE id = ? AND agent_id = ? AND status = 'approved' AND approved_until > ?", hashKey(token), tokenExpiresAt, id, agent.id, now);
    if (!n) throw new HttpError(409, "not_claimable", "This authorization can no longer be claimed.");
    return { view: { ...view(row), token, tokenExpiresAt } };
  });
}

/**
 * Spends the token. Call it immediately before acting and act only on a 200. The body must repeat the
 * exact tool, action, resource and detail that were approved. Nothing is retried safely after an
 * ambiguous failure: ask for a fresh authorization instead.
 */
export async function consumeAuthorization(db: DB, agent: Agent, id: string, body: unknown, now = Date.now()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(422, "invalid_request", "Body must be a JSON object.");
  const { token, ...rest } = body as Record<string, unknown>;
  if (typeof token !== "string" || !TOKEN.test(token)) throw new HttpError(403, "invalid_token", "The authorization token is missing or malformed.");
  const parsed = parseAuthRequest(rest);
  if (!parsed.ok) throw new HttpError(422, "invalid_request", "The execution parameters did not validate.", { errors: parsed.errors });
  const th = hashKey(token), fp = fingerprint(agent.id, parsed.request);

  const out = await db.tx(async (q): Promise<{ row: Row } | { err: HttpError }> => {
    await q.lockEvents();
    await expireStale(q, now);
    const row = await q.get<Row>("SELECT * FROM authorizations WHERE id = ? AND agent_id = ?", id, agent.id);
    if (!row) return { err: new HttpError(404, "authorization_not_found", "No authorization with that id.") };
    const alert = (reason: string, extra: object = {}) => insertEvent(q, {
      agentId: agent.id, type: "alert.raised", actor: "system", at: now,
      data: { kind: reason === "replay" ? "authorization_replay" : "authorization_mismatch", authorizationId: id, ...bound(row), reason, ...extra },
    });

    if (row.status === "consumed") {
      if (row.token_hash !== th) return { err: new HttpError(403, "invalid_token", "The authorization token is not valid.") };
      await alert("replay");
      return { err: new HttpError(409, "already_consumed", "This authorization was already used.") };
    }
    if (row.status !== "approved") return { err: new HttpError(403, "not_approved", `This authorization is ${row.status}.`, { status: row.status }) };
    const d = await stillPermitted(q, row);
    if (d.effect === "deny") return { err: new HttpError(403, "not_permitted", "The agent is no longer allowed to do this.", { reason: d.reason }) };

    // The one atomic step. Token, expiry and the bound fingerprint are checked together.
    const won = await q.run(
      `UPDATE authorizations SET status = 'consumed', consumed_at = ?
       WHERE id = ? AND agent_id = ? AND status = 'approved' AND token_hash = ? AND token_expires_at > ? AND approved_until > ? AND fingerprint = ?`,
      now, id, agent.id, th, now, now, fp);
    if (won) {
      await insertEvent(q, { agentId: agent.id, type: "authorization.consumed", actor: "system", at: now, data: { authorizationId: id, ...bound(row) } });
      return { row };
    }

    // Refused. Say why, and count repeated attempts to use it for something else.
    const tokenOk = row.token_hash !== null && row.token_hash === th;
    if (tokenOk && row.fingerprint === fp) return { err: new HttpError(403, "token_expired", "The token expired. Claim a new one while the approval is still valid.") };
    const revoke = row.mismatches + 1 >= MISMATCH_LIMIT;
    await q.run(revoke
      ? "UPDATE authorizations SET mismatches = mismatches + 1, status = 'cancelled', token_hash = NULL WHERE id = ? AND status = 'approved'"
      : "UPDATE authorizations SET mismatches = mismatches + 1 WHERE id = ? AND status = 'approved'", id);
    await alert(tokenOk ? "parameters_differ" : "invalid_token", { revoked: revoke });
    return { err: tokenOk
      ? new HttpError(403, "mismatch", "The tool, action, resource or detail differ from what was approved.")
      : new HttpError(403, "invalid_token", "The authorization token is not valid.") };
  });
  if ("err" in out) throw out.err;
  return { authorized: true, authorizationId: id, ...bound(out.row) };
}

/**
 * Spends an approved authorization without a token (the one-round-trip flow): the agent's key, the exact request (fingerprint, arguments
 * included) and one atomic status change from approved to consumed. Of any number of concurrent or repeated attempts at most one wins;
 * a repeat after it won is a replay (alert, 409). The policy is checked again, so tightening it after the approval still stops it.
 */
export async function spendApproved(db: DB, agent: Agent, id: string, body: unknown, now = Date.now()) {
  const parsed = parseAuthRequest(body);
  if (!parsed.ok) throw new HttpError(422, "invalid_request", "The execution parameters did not validate.", { errors: parsed.errors });
  const fp = fingerprint(agent.id, parsed.request);
  const out = await db.tx(async (q): Promise<{ row: Row } | { err: HttpError }> => {
    await q.lockEvents();
    await expireStale(q, now);
    const row = await q.get<Row>("SELECT * FROM authorizations WHERE id = ? AND agent_id = ?", id, agent.id);
    if (!row) return { err: new HttpError(404, "authorization_not_found", "No authorization with that id.") };
    const alert = (reason: string, extra: object = {}) => insertEvent(q, {
      agentId: agent.id, type: "alert.raised", actor: "system", at: now,
      data: { kind: reason === "replay" ? "authorization_replay" : "authorization_mismatch", authorizationId: id, ...bound(row), reason, ...extra },
    });
    if (row.status === "consumed") {
      await alert("replay");
      return { err: new HttpError(409, "already_consumed", "This authorization was already used.") };
    }
    if (row.status === "pending") return { err: new HttpError(409, "pending", "A person has not decided yet.", { status: row.status }) };
    if (row.status !== "approved") return { err: new HttpError(403, "not_approved", `This authorization is ${row.status}.`, { status: row.status }) };
    const d = await stillPermitted(q, row);
    if (d.effect === "deny") return { err: new HttpError(403, "not_permitted", "The agent is no longer allowed to do this.", { reason: d.reason }) };
    const won = await q.run("UPDATE authorizations SET status = 'consumed', consumed_at = ?, token_hash = NULL WHERE id = ? AND agent_id = ? AND status = 'approved' AND approved_until > ? AND fingerprint = ?", now, id, agent.id, now, fp);
    if (won) {
      await insertEvent(q, { agentId: agent.id, type: "authorization.consumed", actor: "system", at: now, data: { authorizationId: id, ...bound(row) } });
      return { row };
    }
    if (row.fingerprint === fp) return { err: new HttpError(403, "expired", "The approval expired before it was used. Ask again.") };
    const revoke = row.mismatches + 1 >= MISMATCH_LIMIT;
    await q.run(revoke
      ? "UPDATE authorizations SET mismatches = mismatches + 1, status = 'cancelled', token_hash = NULL WHERE id = ? AND status = 'approved'"
      : "UPDATE authorizations SET mismatches = mismatches + 1 WHERE id = ? AND status = 'approved'", id);
    await alert("parameters_differ", { revoked: revoke });
    return { err: new HttpError(403, "mismatch", "The tool, action, resource, detail or arguments differ from what was approved.") };
  });
  if ("err" in out) throw out.err;
  return { authorized: true, authorizationId: id, ...bound(out.row) };
}

/** The agent gives up on a request or approval. A decision on it can no longer do anything. */
export async function cancelAuthorization(db: DB, agent: Agent, id: string, now = Date.now()) {
  await sweepExpired(db, now);
  return db.tx(async (q) => {
    await q.lockEvents();
    await expireStale(q, now);
    const row = await mine(q, agent.id, id);
    if (row.status === "cancelled") return view(row);
    if (!(await q.run("UPDATE authorizations SET status = 'cancelled', token_hash = NULL WHERE id = ? AND agent_id = ? AND status IN ('pending', 'approved')", id, agent.id)))
      throw new HttpError(409, "not_cancellable", `This authorization is ${row.status}.`, { status: row.status });
    if (await q.run("UPDATE reviews SET status = 'withdrawn', decided_at = ? WHERE id = ? AND status = 'pending'", now, id))
      await insertEvent(q, { agentId: agent.id, type: "review.withdrawn", actor: "system", at: now, data: { reviewId: id, reason: "cancelled by the agent" } });
    await insertEvent(q, { agentId: agent.id, type: "authorization.cancelled", actor: "agent", at: now, data: { authorizationId: id } });
    return view((await q.get<Row>("SELECT * FROM authorizations WHERE id = ?", id))!);
  });
}
