// Workspace members: invitations, role changes, removal (roles and their limits: src/server/rbac.ts). Every change is checked on the server against
// the actor's role from their session, runs in one transaction with every member of the workspace locked (so two admins cannot demote the last two
// owners at the same moment), and is recorded in the append-only authentication log (member.invited / member.role_changed / member.removed).
import { randomUUID } from "node:crypto";
import { audit, type Session } from "./session.ts";
import { base, cleanEmail, issueToken, type Outbox } from "./accounts.ts";
import { HttpError } from "./http.ts";
import { spend } from "./limits.ts";
import { isRole, roleChangeProblem, type Role } from "./rbac.ts";
import type { DB, Q } from "./db.ts";

const INVITE_TTL = 7 * 24 * 3_600_000;
const INVITES_PER_HOUR = 20;
/** Stored for an invited member until they choose a password: not a scrypt hash, so no password ever matches it (checkPassword). */
const NO_PASSWORD = "!invited";

interface MemberRow { id: string; email: string; role: string; workspace_id: string; disabled_at: number | null; email_verified_at: number | null; created_at: number; password_hash: string }
const view = (m: MemberRow) => ({
  id: m.id, email: m.email, role: m.role as Role, createdAt: Number(m.created_at),
  status: m.disabled_at !== null ? "removed" : m.password_hash === NO_PASSWORD ? "invited" : "active",
});

export async function listMembers(q: Q, workspace: string) {
  return (await q.all<MemberRow>("SELECT * FROM users WHERE workspace_id = ? ORDER BY created_at", workspace)).map(view);
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

/** Invites someone by e-mail. The mail carries a one-time link (7 days) to choose a password; using it also confirms the address. */
export async function inviteMember(db: DB, req: Request, s: Session, input: unknown, now = Date.now()): Promise<{ member: ReturnType<typeof view>; outbox: Outbox }> {
  const o = (input ?? {}) as { email?: unknown; role?: unknown };
  if (!isRole(o.role)) throw new HttpError(422, "invalid_role", "role must be owner, admin, operator or viewer.");
  const problem = roleChangeProblem(s, {}, o.role);
  if (problem) throw forbidden(problem);
  const email = cleanEmail(o.email);
  if (!(await spend(db, `members:invite:${s.workspace}`, INVITES_PER_HOUR, { windowMs: 3_600_000, now })).ok)
    throw new HttpError(429, "rate_limited", "Too many invitations from this workspace. Try again later.", { retryAfter: 3600 });
  const id = `u_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const token = await db.tx(async (q) => {
    const again = roleChangeProblem(actorNow(s, await lockMembers(q, s.workspace)), {}, o.role as Role);
    if (again) throw forbidden(again);
    // An address that has an account anywhere cannot be invited, so an invitation can never move someone else's account (or its agents) into
    // this workspace. The tenant context sees only this workspace's members; the unique index on users.email guards the rest (caught below).
    if (await q.get("SELECT 1 FROM users WHERE email = ?", email)) throw new HttpError(409, "email_taken", "This address already has a TEND account. Accounts cannot be moved between workspaces.");
    await q.run("INSERT INTO users (id, email, password_hash, workspace_id, created_at, password_changed_at, approved_at, approved_by, role, invited_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, email, NO_PASSWORD, s.workspace, now, now, now, s.id, o.role, s.userId ?? "admin");
    await audit(q, "member.invited", { userId: id, sessionId: s.id, reason: `role=${o.role}`, now });
    return issueToken(q, id, "reset", now, INVITE_TTL);
  }).catch((e) => {
    if (String((e as Error).message).includes("users_email_key")) throw new HttpError(409, "email_taken", "This address already has a TEND account. Accounts cannot be moved between workspaces.");
    throw e;
  });
  const link = `${base(req)}/account/reset#token=${token}`;
  const outbox: Outbox = [{ to: email, subject: "You are invited to a TEND workspace", text: `${s.email ?? "The TEND admin"} invited you to their TEND workspace as ${o.role}.\n\nChoose a password to accept:\n\n${link}\n\nThe link works once, for 7 days. If you do not know this person, ignore this mail.` }];
  const row = (await db.get<MemberRow>("SELECT * FROM users WHERE id = ?", id))!;
  return { member: view(row), outbox };
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
