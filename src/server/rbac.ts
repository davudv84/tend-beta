// Workspace roles. Every operator route declares what it needs (requireOperator(req, db, need) in http.ts); the check runs on the server, from
// the role stored with the account (read again on every request, so a demotion or removal applies at once), never from the request.
//
//   view     any member: read the workspace
//   self     any member: their own settings (notifications, onboarding, their own sessions)
//   operate  operator and up: decide approvals, pause/resume agents, ask for check-ins, run protection checks
//   manage   admin and up: agents, keys, rules, central policies, the sample agent
//   members  admin and up: invite members, change roles, remove members (within the limits below)
import { HttpError } from "./http.ts"; // used at call time only, so the import cycle with http.ts is harmless

export const ROLES = ["viewer", "operator", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];
export type Need = "view" | "self" | "operate" | "manage" | "members";
const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2, owner: 3 };
const NEEDS: Record<Need, Role> = { view: "viewer", self: "viewer", operate: "operator", manage: "admin", members: "admin" };

export const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as readonly string[]).includes(r);
export const atLeast = (have: Role, want: Role) => RANK[have] >= RANK[want];

/** Throws 403 unless `role` may do `need`. */
export function authorize(role: Role, need: Need) {
  if (!atLeast(role, NEEDS[need])) throw new HttpError(403, "forbidden_role", `Your role (${role}) cannot do this. Ask a workspace ${NEEDS[need]} or owner.`);
}

/**
 * Whether `actor` may set `target` (currently `from`, or a new member when undefined) to `to`. No one assigns a role above their own, changes
 * a member above their own role, or changes their own role. Keeping at least one owner is checked by the caller, inside its transaction.
 */
export function roleChangeProblem(actor: { role: Role; userId: string | null }, target: { userId?: string; from?: Role }, to: Role | "removed"): string | undefined {
  if (!atLeast(actor.role, "admin")) return "Only an admin or owner can manage members.";
  if (target.userId && target.userId === actor.userId) return "You cannot change or remove your own membership. Ask another admin or owner.";
  if (target.from && !atLeast(actor.role, target.from)) return `Only an ${target.from} or higher can change an ${target.from}.`;
  if (to !== "removed" && !atLeast(actor.role, to)) return `You cannot give a role above your own (${actor.role}).`;
  return undefined;
}
