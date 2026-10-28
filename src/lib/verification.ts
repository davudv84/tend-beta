// Verified Protection: what a check result looks like, shared by the server and the screen. Pure; no server imports.
//
// Three statuses, each about ONE stated claim, never about the agent as a whole:
//   verified      Tend itself checked this specific claim (on this server now, or in a private test) and it held.
//   at_risk       Tend found evidence that the claim is false, or that protection is weaker than configured.
//   not_verified  Tend cannot check it, could not run the check, or has no evidence either way. It never means "safe".
// There is deliberately no overall rating, score or "protected" label anywhere.

export type CheckStatus = "verified" | "at_risk" | "not_verified";
/** live: read from this server's settings and recorded history now. isolated: run on a private copy with the agent's rules. outside: beyond what Tend can see. */
export type CheckGroup = "live" | "isolated" | "outside";

export const CHECKS = {
  live: ["folder_closed", "alert_if_outside", "history_approved", "history_once", "ever_outside"],
  isolated: ["forbidden_refused", "malformed_refused", "ask_first_holds", "rejection_holds", "approval_once"],
  outside: ["agent_isolated"],
} as const satisfies Record<CheckGroup, readonly string[]>;
export type CheckId = (typeof CHECKS)[CheckGroup][number];
export const ALL_CHECKS: { id: CheckId; group: CheckGroup }[] = (Object.keys(CHECKS) as CheckGroup[]).flatMap((group) => CHECKS[group].map((id) => ({ id, group })));

/** A fact shown with a result. Never a path, key, token or note text. */
export type Fact = string | number | string[];

export interface CheckResult {
  id: CheckId;
  group: CheckGroup;
  status: CheckStatus;
  /** Why, as a stable code the screen turns into a sentence (e.g. not_configured, no_history, failed). Present unless verified. */
  why?: string;
  facts: Record<string, Fact>;
}

export interface VerificationRun {
  id: string;
  agentId: string;
  at: number;
  /** The operator session that ran it. Operators only. */
  by?: string;
  /** The agent's settings version the checks ran against. If it has moved on, the result is out of date. */
  configVersion: number;
  enforcement: "monitor" | "enforce";
  durationMs: number;
  checks: CheckResult[];
  /** Tools the rules let the agent use without asking. A fact about the settings, not a check. */
  runsWithoutAsking: string[];
}

export const outOfDate = (run: Pick<VerificationRun, "configVersion">, agent: { configVersion: number }) => run.configVersion !== agent.configVersion;

export const countByStatus = (checks: Pick<CheckResult, "status">[]) => ({
  verified: checks.filter((c) => c.status === "verified").length,
  atRisk: checks.filter((c) => c.status === "at_risk").length,
  notVerified: checks.filter((c) => c.status === "not_verified").length,
});
