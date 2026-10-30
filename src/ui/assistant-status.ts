import type { Dict } from "@/i18n";
import { timeAgo } from "@/lib/format";
import { connectionOf, protectionOf, type Connection } from "@/lib/home";
import { presenceOf } from "@/lib/protection";
import type { Agent } from "@/lib/types";
import type { VerificationRun } from "@/lib/verification";

/**
 * The two honest lines about an assistant, worded once so the list, Home and the assistant's own page always agree:
 * how it is connected, and what its protection checks last showed. Never a total or a grade.
 */
export function assistantStatus(t: Dict, agent: Agent, run: VerificationRun | null | undefined, now: number) {
  const a = t.home.assistants;
  // An invented sample assistant has no connection to describe, and saying "not heard from" or "paused by you" would be untrue.
  if (agent.origin === "demo") return { connection: "never" as Connection, line: a.sample, second: "", attention: false };
  const connection: Connection = connectionOf(agent, now);
  const protection = protectionOf(agent, run);
  const ago = agent.lastSeenAt ? timeAgo(agent.lastSeenAt, now) : "";
  // Paused or switched off is said as such; otherwise what TEND actually heard: running, quiet, a session that ended, or nothing for a long time.
  const presence = presenceOf(agent, now);
  const line = connection === "paused" || connection === "disabled" ? a.connection[connection] : presence === "never" ? a.presence.never : a.presence[presence](ago);
  const second =
    protection.state === "not_run" ? a.protection.not_run
    : protection.state === "ran" ? a.protection.ran(timeAgo(protection.at, now), protection.outOfDate)
    : protection.state === "attention" ? a.protection.attention(protection.atRisk)
    : "";
  return { connection, line, second, attention: protection.state === "attention" };
}
