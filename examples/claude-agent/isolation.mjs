// Preflight for an agent whose only way to act is the Tend gateway. It refuses to run when the agent's own
// environment holds something that would let it skip the gateway, and when Tend does not have the agent in
// enforce mode. It fails closed and never prints a value, only the variable names.
//
// What this proves: the agent process was not handed gateway credentials or Tend server secrets through its
// environment. What it cannot prove: that the process has no other route to the protected resource (a mounted
// volume, a shared host, a network path). That is a deployment property, see docs/gateway.md.

/** Variables that belong to the Tend server. An agent that holds one can act without, or approve for, Tend. */
const SERVER_ONLY = [/^TEND_GATEWAY_/, /^TEND_ADMIN_TOKEN$/, /^TEND_DATA_DIR$/, /^DATABASE_URL$/, /^POSTGRES_URL$/];

export class IsolationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "IsolationError";
    this.code = code;
  }
}

/** An empty value counts as unset, as it does on the server. */
export function directAccessVars(env) {
  return Object.keys(env).filter((k) => env[k] && SERVER_ONLY.some((re) => re.test(k))).sort();
}

export function assertNoDirectAccess(env) {
  const found = directAccessVars(env);
  if (found.length > 0) throw new IsolationError("direct_access", `Refusing to run: this process holds credentials meant for the Tend server (${found.join(", ")}). Remove them from the agent's environment.`);
}

/** Tend's answer to GET /api/v1/agent/inbox. Anything but an explicit "enforce" is refused. */
export function assertEnforced(config) {
  if (config?.enforcement !== "enforce") throw new IsolationError("not_enforced", "Refusing to run: Tend does not have this agent in enforce mode. Set enforcement to enforce for it first.");
}
