// Live checks: what Tend can read from its own settings, its own folder metadata and its own recorded history, right now.
// They never change anything and never read customer content:
//  - the database is reached only through a read-only wrapper (verification.ts), and every query here is a SELECT;
//  - the notes folder is looked at with lstat only: its owner and permission bits, never its listing or any file in it.
// Nothing returned contains a path, a key, a token or any note text.
import { lstat } from "node:fs/promises";
import path from "node:path";
import type { CheckResult, CheckStatus, Fact } from "../lib/verification.ts";
import type { Q } from "./db.ts";

const result = (id: CheckResult["id"], status: CheckStatus, facts: Record<string, Fact> = {}, why?: string): CheckResult => ({ id, group: "live", status, facts, ...(why && { why }) });

/** The notes folder is closed to every account but the one running Tend. About the folder's settings only. */
export async function folderClosed(notesDir: string | undefined): Promise<CheckResult> {
  if (!notesDir || !path.isAbsolute(notesDir)) return result("folder_closed", "not_verified", {}, "not_configured");
  if (typeof process.getuid !== "function") return result("folder_closed", "not_verified", {}, "cannot_read_owner");
  let st;
  try {
    st = await lstat(notesDir);
  } catch {
    return result("folder_closed", "not_verified", {}, "cannot_inspect");
  }
  if (st.isSymbolicLink()) return result("folder_closed", "not_verified", {}, "is_link");
  if (!st.isDirectory()) return result("folder_closed", "not_verified", {}, "not_a_folder");
  const mode = `0${(st.mode & 0o777).toString(8)}`;
  if (st.uid !== process.getuid()) return result("folder_closed", "at_risk", { mode }, "owned_by_other_account");
  if ((st.mode & 0o077) !== 0) return result("folder_closed", "at_risk", { mode }, "open_to_others");
  return result("folder_closed", "verified", { mode });
}

/** Tend is set to raise an alert if this agent reports acting without asking. A setting, read from the database. */
export const alertIfOutside = (enforcement: "monitor" | "enforce"): CheckResult =>
  enforcement === "enforce" ? result("alert_if_outside", "verified", { enforcement }) : result("alert_if_outside", "at_risk", { enforcement }, "monitor_only");

const RECENT = 500;

/** Every action Tend ran that needed your approval has a recorded approval made before it ran. Over the last 500 used authorizations. */
export async function historyApproved(q: Q, agentId: string): Promise<CheckResult> {
  const rows = await q.all<{ reason: string | null; approved: boolean }>(
    `SELECT a.reason,
            EXISTS (SELECT 1 FROM events e WHERE e.agent_id = a.agent_id AND e.type = 'review.decided'
                      AND (e.data::jsonb)->>'authorizationId' = a.id AND (e.data::jsonb)->>'status' = 'approved' AND e.at <= a.consumed_at) AS approved
       FROM authorizations a WHERE a.agent_id = ? AND a.status = 'consumed' ORDER BY a.consumed_at DESC LIMIT ${RECENT}`, agentId);
  if (rows.length === 0) return result("history_approved", "not_verified", {}, "no_history");
  const needed = rows.filter((r) => r.reason === "approval_required");
  const missing = needed.filter((r) => !r.approved).length;
  const ranWithoutAsking = rows.length - needed.length;
  if (missing > 0) return result("history_approved", "at_risk", { checked: needed.length, missing }, "missing_approval");
  if (needed.length === 0) return result("history_approved", "not_verified", { checked: rows.length, ranWithoutAsking }, "nothing_needed_approval");
  return result("history_approved", "verified", { checked: needed.length, ranWithoutAsking });
}

/** No approval was used more than once, in what Tend has recorded. */
export async function historyOnce(q: Q, agentId: string): Promise<CheckResult> {
  const total = (await q.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM events WHERE agent_id = ? AND type = 'authorization.consumed'", agentId))!.n;
  if (total === 0) return result("history_once", "not_verified", {}, "no_history");
  const twice = await q.all<{ id: string }>(
    `SELECT (data::jsonb)->>'authorizationId' AS id FROM events
      WHERE agent_id = ? AND (type = 'authorization.consumed' OR (type = 'tool.called' AND (data::jsonb)->>'via' = 'gateway' AND (data::jsonb)->>'outcome' = 'success'))
      GROUP BY 1 HAVING COUNT(*) FILTER (WHERE type = 'authorization.consumed') > 1 OR COUNT(*) FILTER (WHERE type = 'tool.called') > 1`, agentId);
  return twice.length > 0 ? result("history_once", "at_risk", { checked: total, usedTwice: twice.length }, "used_twice") : result("history_once", "verified", { checked: total });
}

/**
 * Has the agent ever reported acting outside Tend? Reports that an action ran without, or differently from, what was approved.
 * Finding one is At Risk. Finding none is NOT verified: an agent that skips Tend would not report anything.
 */
export async function everOutside(q: Q, agentId: string): Promise<CheckResult> {
  const r = (await q.get<{ n: number; last: number | null }>(
    `SELECT COUNT(*)::int AS n, MAX(at) AS last FROM events
      WHERE agent_id = ? AND type = 'alert.raised' AND (
        (data::jsonb)->>'kind' IN ('unauthorized_execution', 'unapproved_execution')
        OR ((data::jsonb)->>'kind' = 'authorization_replay' AND (data::jsonb)->>'reason' = 'executed_twice')
        OR ((data::jsonb)->>'kind' = 'authorization_mismatch' AND (data::jsonb)->>'reason' IN ('unknown_authorization', 'not_consumed', 'execution_differs')))`, agentId))!;
  return r.n > 0 ? result("ever_outside", "at_risk", { reports: r.n, ...(r.last && { lastAt: r.last }) }, "reported") : result("ever_outside", "not_verified", {}, "nothing_reported");
}

/** What Tend can never see from where it runs. Always not verified, and says so. */
export const agentIsolated = (): CheckResult => ({ id: "agent_isolated", group: "outside", status: "not_verified", why: "cannot_be_checked", facts: {} });
