// Workspace roles (src/server/rbac.ts, src/server/members.ts): what each role may do, invitations, role changes, removal, privilege escalation,
// stale roles, cross-workspace ids, and the audit trail. Embedded database; the same code runs under row-level security on PostgreSQL.
import assert from "node:assert/strict";
import { test } from "node:test";
import { passwordSignIn, register, setAccess, verifyEmail } from "./accounts.ts";
import { memoryDb, type DB } from "./db.ts";
import { requireOperator } from "./http.ts";
import { acceptInvitation, inviteMember, listMembers, removeMember, setMemberRole } from "./members.ts";
import { authorize, roleChangeProblem, type Need, type Role } from "./rbac.ts";
import { currentSession, sessionCookieName, type Session } from "./session.ts";
import { withRequestContext } from "./db-context.ts";

process.env.TEND_ADMIN_TOKEN = "t".repeat(8) + "0123456789abcdefghijklmnop";
process.env.TEND_DEMO = "0";
process.env.TEND_PUBLIC = "0";
process.env.TEND_TRUSTED_PROXY = "1";
delete process.env.TEND_ACCOUNTS;

let ipn = 0;
const post = () => new Request("http://tend.test/api/account/x", { method: "POST", headers: { host: "tend.test", "x-forwarded-for": `10.2.0.${++ipn % 250}` } });
const get = (cookie: string) => new Request("http://tend.test/api/v1/state", { headers: { host: "tend.test", cookie: `${sessionCookieName()}=${cookie}` } });
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const PW = "correct horse battery";
const tokenIn = (text: string) => /#token=([A-Za-z0-9_-]{43})/.exec(text)![1];

async function founder(db: DB, email: string) {
  const r = await register(db, post(), { email, password: PW });
  await verifyEmail(db, post(), { token: tokenIn(r.outbox[0].text), password: PW });
  await setAccess(db, post(), (await db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", email))!.id, "approve", "admin");
  return signIn(db, email);
}
async function signIn(db: DB, email: string, pw = PW) {
  const s = await passwordSignIn(db, post(), { email, password: pw });
  return { ...(await currentSession(db, get(s.value)))!, cookie: s.value };
}
async function invited(db: DB, by: Session, email: string, role: Role) {
  const { outbox } = await inviteMember(db, post(), by, { email, role });
  await acceptInvitation(db, { token: tokenIn(outbox[0].text), password: PW });
  return signIn(db, email);
}
const sees = (db: DB, s: { cookie: string }) => withRequestContext(() => currentSession(db, get(s.cookie)));

test("RBAC-1 permission matrix: each role gets exactly its needs, checked by requireOperator from the server-side account", async () => {
  const want: Record<Role, Need[]> = { viewer: ["view", "self"], operator: ["view", "self", "operate"], admin: ["view", "self", "operate", "manage", "members"], owner: ["view", "self", "operate", "manage", "members"] };
  for (const [role, needs] of Object.entries(want) as [Role, Need[]][])
    for (const need of ["view", "self", "operate", "manage", "members"] as Need[])
      assert.equal(await code(Promise.resolve().then(() => authorize(role, need))), needs.includes(need) ? "ok" : "forbidden_role", `${role} ${need}`);
  const db = await memoryDb();
  const owner = await founder(db, "owner@example.com");
  assert.equal(owner.role, "owner", "the account that founded the workspace owns it");
  const v = await invited(db, owner, "viewer@example.com", "viewer");
  const o = await invited(db, owner, "op@example.com", "operator");
  for (const [s, need, expect] of [[v, "view", "ok"], [v, "operate", "forbidden_role"], [o, "operate", "ok"], [o, "manage", "forbidden_role"], [o, "members", "forbidden_role"], [owner, "members", "ok"]] as const)
    assert.equal(await code(withRequestContext(() => requireOperator(get(s.cookie), db, need))), expect, `${s.role} → ${need}`);
});

test("RBAC-2 invitations: nothing exists until accepted, so an invitation cannot claim an address, block it, move an account, or reveal one", async () => {
  const db = await memoryDb();
  const owner = await founder(db, "owner2@example.com");
  const { invitation, outbox } = await inviteMember(db, post(), owner, { email: "new@example.com", role: "operator" });
  assert.equal(invitation.status, "invited");
  assert.equal(outbox[0].to, "new@example.com");
  assert.equal(await db.get("SELECT 1 FROM users WHERE email = 'new@example.com'"), undefined, "no account before the link is used");
  assert.ok((await listMembers(db, owner.workspace)).some((m) => m.email === "new@example.com" && m.status === "invited"));
  await acceptInvitation(db, { token: tokenIn(outbox[0].text), password: PW });
  const s = await signIn(db, "new@example.com");
  assert.equal(s.workspace, owner.workspace);
  assert.equal(s.role, "operator");
  assert.equal(await code(acceptInvitation(db, { token: tokenIn(outbox[0].text), password: PW })), "invalid_link", "the link works once");
  // an address with an account elsewhere: the inviter gets the same answer as for a new address, and the link never moves the account
  const other = await founder(db, "elsewhere@example.com");
  const r = await inviteMember(db, post(), owner, { email: "elsewhere@example.com", role: "viewer" });
  assert.equal(r.invitation.status, "invited", "no 'already has an account' answer (no enumeration)");
  assert.equal(await code(acceptInvitation(db, { token: tokenIn(r.outbox[0].text), password: PW })), "invalid_link");
  assert.equal((await signIn(db, "elsewhere@example.com")).workspace, other.workspace, "the existing account stays where it was");
  // invited but never accepted: the real person signs up normally and gets their own workspace; the invitation then no longer works
  const pre = await inviteMember(db, post(), owner, { email: "ceo@example.com", role: "viewer" });
  const ceo = await founder(db, "ceo@example.com");
  assert.notEqual(ceo.workspace, owner.workspace, "an invitation does not pre-claim an address");
  assert.equal(await code(acceptInvitation(db, { token: tokenIn(pre.outbox[0].text), password: PW })), "invalid_link");
  // withdrawn before acceptance: the link dies, and the address stays free to sign up
  const w = await inviteMember(db, post(), owner, { email: "later@example.com", role: "viewer" });
  await removeMember(db, owner, w.invitation.id);
  assert.equal(await code(acceptInvitation(db, { token: tokenIn(w.outbox[0].text), password: PW })), "invalid_link");
  assert.equal((await founder(db, "later@example.com")).role, "owner", "the address can still create its own account");
  assert.equal(await code(inviteMember(db, post(), owner, { email: "x@example.com", role: "superuser" })), "invalid_role");
});

test("RBAC-3 privilege escalation: nobody grants above their own role, changes someone above them, or changes themselves", async () => {
  const db = await memoryDb();
  const owner = await founder(db, "owner3@example.com");
  const admin = await invited(db, owner, "admin3@example.com", "admin");
  const op = await invited(db, owner, "op3@example.com", "operator");
  const viewer = await invited(db, owner, "viewer3@example.com", "viewer");
  assert.equal(await code(inviteMember(db, post(), admin, { email: "o2@example.com", role: "owner" })), "forbidden_role", "admin cannot create an owner");
  assert.equal(await code(inviteMember(db, post(), op, { email: "o3@example.com", role: "viewer" })), "forbidden_role", "operator cannot invite");
  assert.equal(await code(setMemberRole(db, admin, owner.userId!, "viewer")), "forbidden_role", "admin cannot demote an owner");
  assert.equal(await code(removeMember(db, admin, owner.userId!)), "forbidden_role", "admin cannot remove an owner");
  assert.equal(await code(setMemberRole(db, admin, admin.userId!, "owner")), "forbidden_role", "nobody promotes themselves");
  assert.equal(await code(setMemberRole(db, admin, op.userId!, "owner")), "forbidden_role", "admin cannot make an owner");
  assert.equal(await code(setMemberRole(db, op, viewer.userId!, "operator")), "forbidden_role", "operator cannot change roles");
  assert.equal(await code(setMemberRole(db, admin, op.userId!, "admin")), "ok", "admin may promote up to admin");
  assert.equal(await code(setMemberRole(db, owner, owner.userId!, "admin")), "forbidden_role", "the owner cannot demote themselves either");
  assert.equal(roleChangeProblem({ role: "owner", userId: "a" }, { userId: "b", from: "owner" }, "viewer"), undefined, "owner may change another owner");
});

test("RBAC-4 changes apply on the next request: demoted, removed and stale-role actors lose their rights at once", async () => {
  const db = await memoryDb();
  const owner = await founder(db, "owner4@example.com");
  const admin = await invited(db, owner, "admin4@example.com", "admin");
  const op = await invited(db, owner, "op4@example.com", "operator");
  await setMemberRole(db, owner, op.userId!, "viewer");
  assert.equal((await sees(db, op))!.role, "viewer", "a demotion applies to the next request");
  assert.equal(await code(withRequestContext(() => requireOperator(get(op.cookie), db, "operate"))), "forbidden_role");
  // the admin's session object still says admin, but the owner demoted them a moment ago: their next member action is refused
  const staleAdmin = (await sees(db, admin))!;
  await setMemberRole(db, owner, admin.userId!, "viewer");
  assert.equal(await code(setMemberRole(db, staleAdmin, op.userId!, "operator")), "forbidden_role", "a role checked earlier is checked again inside the change");
  await removeMember(db, owner, op.userId!);
  assert.equal(await sees(db, op), undefined, "a removed member's session ends at once");
  assert.equal(await code(signIn(db, "op4@example.com")), "account_disabled");
  const list = await listMembers(db, owner.workspace);
  assert.deepEqual(list.map((m) => [m.email, m.role, m.status]), [["owner4@example.com", "owner", "active"], ["admin4@example.com", "viewer", "active"], ["op4@example.com", "viewer", "removed"]]);
});

test("RBAC-5 a workspace always keeps an owner, also when two owners demote each other at the same moment", async () => {
  const db = await memoryDb();
  const a = await founder(db, "a5@example.com");
  const b = await invited(db, a, "b5@example.com", "owner");
  const results = await Promise.all([code(setMemberRole(db, a, b.userId!, "admin")), code(setMemberRole(db, b, a.userId!, "admin"))]);
  assert.deepEqual(results.sort(), ["forbidden_role", "ok"], "exactly one demotion wins; the other actor is no longer an owner when its change runs");
  assert.equal((await listMembers(db, a.workspace)).filter((m) => m.role === "owner").length, 1);
});

test("RBAC-6 another workspace's member ids are 'not found', and member changes are in the authentication log with who and what", async () => {
  const db = await memoryDb();
  const one = await founder(db, "one6@example.com");
  const two = await founder(db, "two6@example.com");
  const twoOp = await invited(db, two, "op6@example.com", "operator");
  assert.equal(await code(setMemberRole(db, one, twoOp.userId!, "viewer")), "member_not_found");
  assert.equal(await code(removeMember(db, one, twoOp.userId!)), "member_not_found");
  assert.equal(await code(removeMember(db, one, two.userId!)), "member_not_found");
  assert.ok(!(await listMembers(db, one.workspace)).some((m) => m.email.startsWith("two6") || m.email.startsWith("op6")));
  await setMemberRole(db, two, twoOp.userId!, "viewer");
  await removeMember(db, two, twoOp.userId!);
  const log = await db.all<{ type: string; reason: string; session_id: string | null }>("SELECT type, reason, session_id FROM auth_events WHERE user_id = ? AND type LIKE 'member.%' ORDER BY seq", twoOp.userId);
  assert.deepEqual(log.map((r) => [r.type, r.reason.replace(/inv_\w+ /, "")]), [["member.joined", "role=operator"], ["member.role_changed", "operator->viewer"], ["member.removed", "was viewer"]]);
  assert.ok(log.slice(1).every((r) => r.session_id === two.id), "changes are recorded with the session that made them");
  const invitedLog = await db.get<{ reason: string }>("SELECT reason FROM auth_events WHERE user_id = ? AND type = 'member.invited'", two.userId);
  assert.match(invitedLog!.reason, /^inv_\w+ role=operator email=[0-9a-f]{12}$/, "the invitation is recorded against the inviter, the address only as a hash");
  // disabling one member of a shared workspace leaves the others' agent keys alone (only the last active member takes them along)
  assert.equal((await sees(db, two))!.role, "owner");
});
