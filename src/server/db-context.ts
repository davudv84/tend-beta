// Which tenant the database may show to the code running now. Set on the server, from authentication only (a session or an agent key resolved by
// the server), never from anything a client sends. src/server/db.ts turns it into a transaction-scoped PostgreSQL setting (SET LOCAL, so it ends
// with the transaction and cannot leak to the next request on a pooled connection) that the row-level security policies read.
//
//   no context (code outside a request)      → nothing tenant-scoped is visible (fail closed)
//   a request before authentication          → nothing tenant-scoped is visible
//   bindWorkspace(ws) after authentication    → that workspace only
//   asSystem(fn)                              → every workspace, for the explicit, reviewed cross-tenant paths only (sign-in lookups, the admin, the
//                                               push queue). `grep -n asSystem src` lists every one of them.
//
// What this does NOT protect against: SQL executed by an attacker in the application's database session can set the same settings. RLS here
// stops the application's own mistakes (a missing workspace check, a query without a filter) from crossing tenants; SQL injection is countered by
// parameterised queries and the restricted role's privileges (docs/database-roles.md), not by this.
import { AsyncLocalStorage } from "node:async_hooks";

export interface DbContext { workspace?: string; system?: boolean }
const als = new AsyncLocalStorage<DbContext>();
const WORKSPACE = /^[A-Za-z0-9_.:-]{1,64}$/;

export const dbContext = (): DbContext | undefined => als.getStore();

/** A fresh, unauthenticated context for one request (route handlers and server pages). Mutated in place once the caller is authenticated. */
export const withRequestContext = <T>(fn: () => T): T => als.run({}, fn);

/** After authentication: this request may see this workspace. Binding a second, different workspace in the same request is refused. */
export function bindWorkspace(workspace: string) {
  const c = als.getStore();
  if (!c) return;
  if (!WORKSPACE.test(workspace)) throw new Error("invalid workspace id for the database context");
  if (c.workspace && c.workspace !== workspace) throw new Error("this request is already bound to another workspace");
  c.workspace = workspace;
}

/** The platform admin's own routes (approving accounts, verifying the whole audit log) work across workspaces. */
export function bindSystem() {
  const c = als.getStore();
  if (c) c.system = true;
}

/** Runs one reviewed cross-tenant operation. Whatever it binds stays inside it. */
export const asSystem = <T>(fn: () => Promise<T>): Promise<T> => als.run({ ...(als.getStore() ?? {}), system: true }, fn);

/** The settings a transaction runs with: values are validated here, so they can be written into SQL as literals. */
export function contextSettings(): { workspace: string; system: "on" | "off" } {
  const c = als.getStore();
  const workspace = c?.workspace && WORKSPACE.test(c.workspace) ? c.workspace : "";
  return { workspace, system: c?.system ? "on" : "off" };
}
