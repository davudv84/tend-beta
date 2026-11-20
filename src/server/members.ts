// Workspace members: invitations, role changes, removal (roles and their limits: src/server/rbac.ts). Every change is checked on the server against
// the actor's role from their session, runs in one transaction with every member of the workspace locked (so two admins cannot demote the last two
// owners at the same moment), and is recorded in the append-only authentication log (member.invited / joined / invite_revoked / role_changed / removed).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { audit, type Session } from "./session.ts";
import { base, cleanEmail, hashPassword, passwordProblem, type Outbox } from "./accounts.ts";
import { HttpError } from "./http.ts";
import { spend } from "./limits.ts";
import { isRole, roleChangeProblem, type Role } from "./rbac.ts";
import type { DB, Q } from "./db.ts";

const INVITE_TTL = 7 * 24 * 3_600_000;
const INVITES_PER_HOUR = 20;
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

interface MemberRow { id: string; email: string; role: string; workspace_id: string; disabled_at: number | null; email_verified_at: number | null; created_at: number; password_hash: string }
interface InvitationRow { id: string; workspace_id: string; email: string; role: string; invited_by: string; created_at: number; expires_at: number; accepted_at: number | null; revoked_at: number | null }
const view = (m: MemberRow) => ({ id: m.id, email: m.email, role: m.role as Role, createdAt: Number(m.created_at), status: m.disabled_at !== null ? "removed" : "active" });
const invitationView = (i: InvitationRow) => ({ id: i.id, email: i.email, role: i.role as Role, createdAt: Number(i.created_at), expiresAt: Number(i.expires_at), status: "invited" as const });

/** Members, and invitations not yet accepted, withdrawn or expired. */
export async function listMembers(q: Q, workspace: string, now = Date.now()) {
  const members = (await q.all<MemberRow>("SELECT * FROM users WHERE workspace_id = ? ORDER BY created_at", workspace)).map(view);
  const pending = (await q.all<InvitationRow>("SELECT * FROM invitations WHERE workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at", workspace, now)).map(invitationView);
  return [...members, ...pending];
}

const forbidden = (why: string) => new HttpError(403, "forbidden_role", why);

/** Locks every member of the workspace and returns them; the target must be one of them (another workspace's id is "not found"). */
async function lockMembers(q: Q, workspace: string) {
  return q.all<MemberRow>("SELECT * FROM users WHERE workspace_id = ? ORDER BY id FOR UPDATE", workspace);
}
/** The actor as they are NOW (inside the locked transaction), not as the session lookup saw them a moment ago: a demotion or removal that
 *  committed in between applies. The platform admin (no account) owns the default workspace only. */
function actorNow(s: Session, members: MemberRow[]): { role: Role; userId: string | null } {
  if (!s.userId) return { role: s.role, userId: null };
  const me = members.find((m) => m.id === s.userId && m.disabled_at === null);
  if (!me || !isRole(me.role)) throw forbidden("Your membership has changed. Reload and try again.");
  return { role: me.role, userId: s.userId };
}
function keepsAnOwner(members: MemberRow[], targetId: string) {
  return members.some((m) => m.id !== targetId && m.role === "owner" && m.disabled_at === null);
}

/**
 * Invites someone by e-mail: a one-time link (7 days) to create their account in this workspace with the given role. No account exists until
 * the link is used, so an invitation claims nothing. The answer is the same whether or not the address already has an account somewhere (no
 * account enumeration); an existing account cannot accept (accounts never move between workspaces) and its owner is simply told.
 */
export async function inviteMember(db: DB, req: Request, s: Session, input: unknown, now = Date.now()): Promise<{ invitation: ReturnType<typeof invitationView>; outbox: Outbox }> {
  const o = (input ?? {}) as { email?: unknown; role?: unknown };
  if (!isRole(o.role)) throw new HttpError(422, "invalid_role", "role must be owner, admin, operator or viewer.");
  const problem = roleChangeProblem(s, {}, o.role);
  if (problem) throw forbidden(problem);
  const email = cleanEmail(o.email);
  if (!(await spend(db, `members:invite:${s.workspace}`, INVITES_PER_HOUR, { windowMs: 3_600_000, now })).ok)
    throw new HttpError(429, "rate_limited", "Too many invitations from this workspace. Try again later.", { retryAfter: 3600 });
  const token = randomBytes(32).toString("base64url");
  const id = `inv_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const row = await db.tx(async (q) => {
    const again = roleChangeProblem(actorNow(s, await lockMembers(q, s.workspace)), {}, o.role as Role);
    if (again) throw forbidden(again);
    // A newer invitation to the same address replaces the older one (its link stops working).
    await q.run("UPDATE invitations SET revoked_at = ? WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL", now, s.workspace, email);
    await q.run("INSERT INTO invitations (id, workspace_id, email, role, token_hash, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id, s.workspace, email, o.role, sha(token), s.userId ?? "admin", now, now + INVITE_TTL);
    // Recorded against the inviter (the invitee has no account yet); the address only as a hash.
    if (s.userId) await audit(q, "member.invited", { userId: s.userId, sessionId: s.id, reason: `${id} role=${o.role} email=${sha(email).slice(0, 12)}`, now });
    return (await q.get<InvitationRow>("SELECT * FROM invitations WHERE id = ?", id))!;
  });
  const link = `${base(req)}/account/accept#token=${token}`;
  const outbox: Outbox = [{ to: email, subject: "You are invited to a TEND workspace", text: `${s.email ?? "The TEND admin"} invited you to their TEND workspace as ${o.role}.\n\nChoose a password to accept:\n\n${link}\n\nThe link works once, for 7 days. If this address already has a TEND account, the link will not work (accounts cannot move between workspaces). If you do not know this person, ignore this mail.` }];
  return { invitation: invitationView(row), outbox };
}

/** Accepting: creates the account (address confirmed by the link, approved by the inviter) in the inviting workspace. Run as system. */
export async function acceptInvitation(db: DB, input: unknown, now = Date.now()) {
  const o = (input ?? {}) as { token?: unknown; password?: unknown };
  const bad = new HttpError(400, "invalid_link", "This link is not valid any more. Ask for a new invitation.");
  if (typeof o.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(o.token)) throw bad;
  const live = await db.get<InvitationRow>("SELECT * FROM invitations WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?", sha(o.token), now);
  if (!live) throw bad;
  const weak = passwordProblem(o.password, live.email);
  if (weak) throw new HttpError(422, "weak_password", weak);
  const hash = await hashPassword(o.password as string);
  return db.tx(async (q) => {
    const inv = await q.get<InvitationRow>("UPDATE invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? RETURNING *", now, live.id, now);
    if (!inv) throw bad;
    if (await q.get("SELECT 1 FROM users WHERE email = ?", inv.email)) throw bad; // an existing account is never moved
    const userId = `u_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    await q.run("INSERT INTO users (id, email, password_hash, workspace_id, created_at, password_changed_at, email_verified_at, approved_at, approved_by, role, invited_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      userId, inv.email, hash, inv.workspace_id, now, now, now, now, inv.invited_by, inv.role, inv.invited_by);
    await audit(q, "member.joined", { userId, reason: `${inv.id} role=${inv.role}`, now });
    return { ok: true as const, email: inv.email };
  });
}

/** Withdraws an invitation that was not accepted yet. Admins and owners, for roles up to their own. */
async function revokeInvitation(db: DB, s: Session, id: string, now: number) {
  return db.tx(async (q) => {
    const members = await lockMembers(q, s.workspace);
    const inv = await q.get<InvitationRow>("SELECT * FROM invitations WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL", id, s.workspace);
    if (!inv) throw new HttpError(404, "member_not_found", "No such member in this workspace.");
    const problem = roleChangeProblem(actorNow(s, members), { from: inv.role as Role }, "removed");
    if (problem) throw forbidden(problem);
    await q.run("UPDATE invitations SET revoked_at = ? WHERE id = ?", now, id);
    if (s.userId) await audit(q, "member.invite_revoked", { userId: s.userId, sessionId: s.id, reason: id, now });
    return { removed: true as const, id };
  });
}

export async function setMemberRole(db: DB, s: Session, memberId: string, role: unknown, now = Date.now()) {
  if (!isRole(role)) throw new HttpError(422, "invalid_role", "role must be owner, admin, operator or viewer.");
  return db.tx(async (q) => {
    const members = await lockMembers(q, s.workspace);
    const m = members.find((x) => x.id === memberId && x.disabled_at === null);
    if (!m) throw new HttpError(404, "member_not_found", "No such member in this workspace.");
    const problem = roleChangeProblem(actorNow(s, members), { userId: m.id, from: m.role as Role }, role);
    if (problem) throw forbidden(problem);
    if (m.role === role) return view(m);
    if (m.role === "owner" && !keepsAnOwner(members, m.id)) throw new HttpError(409, "last_owner", "A workspace needs at least one owner. Make someone else owner first.");
    await q.run("UPDATE users SET role = ? WHERE id = ? AND workspace_id = ?", role, m.id, s.workspace);
    await audit(q, "member.role_changed", { userId: m.id, sessionId: s.id, reason: `${m.role}->${role}`, now });
    return view({ ...m, role });
  });
}

/** Removes a member: their account is disabled, every session ends and their links stop working. Agents and their keys stay with the workspace. */
export async function removeMember(db: DB, s: Session, memberId: string, now = Date.now()) {
  if (memberId.startsWith("inv_")) return revokeInvitation(db, s, memberId, now);
  return db.tx(async (q) => {
    const members = await lockMembers(q, s.workspace);
    const m = members.find((x) => x.id === memberId && x.disabled_at === null);
    if (!m) throw new HttpError(404, "member_not_found", "No such member in this workspace.");
    const problem = roleChangeProblem(actorNow(s, members), { userId: m.id, from: m.role as Role }, "removed");
    if (problem) throw forbidden(problem);
    if (m.role === "owner" && !keepsAnOwner(members, m.id)) throw new HttpError(409, "last_owner", "A workspace needs at least one owner.");
    await q.run("UPDATE users SET disabled_at = ? WHERE id = ? AND workspace_id = ?", now, m.id, s.workspace);
    await q.run("UPDATE operator_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now, m.id);
    await q.run("UPDATE user_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL", now, m.id);
    await audit(q, "member.removed", { userId: m.id, sessionId: s.id, reason: `was ${m.role}`, now });
    return { removed: true as const, id: m.id };
  });
}
