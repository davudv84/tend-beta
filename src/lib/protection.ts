// What TEND can honestly say about an assistant connected through hooks: whether it is running, and which protections its own records show
// working. Worked out only from what the server recorded (presence, authorizations, reported tool calls). Nothing is assumed from the fact
// that an agent is registered, and nothing a simulated check showed is counted here.
import { TEST_COMMANDS } from "./agent-presets.ts";
import type { Agent, Authorization, TaskEvent } from "./types";

export const RUNNING_FOR = 5 * 60_000;
const DAY = 86_400_000;

/**
 * never    registered, nothing heard yet
 * running  activity in the last five minutes, and the session has not ended
 * quiet    the session has not ended, but nothing for a while (the person may simply not be using it, or it may have stopped without saying so)
 * stopped  the last session ended normally
 * lost     a session that never ended, silent for more than a day
 */
export type Presence = "never" | "running" | "quiet" | "stopped" | "lost";

export function presenceOf(agent: Pick<Agent, "lastSeenAt" | "disconnectedAt">, now: number): Presence {
  if (!agent.lastSeenAt) return "never";
  if (agent.disconnectedAt && agent.disconnectedAt >= agent.lastSeenAt) return "stopped";
  const quiet = now - agent.lastSeenAt;
  return quiet < RUNNING_FOR ? "running" : quiet < DAY ? "quiet" : "lost";
}

export type Check = "working" | "not_verified";
export interface Evidence { connection: Check; monitoring: Check; blocking: Check; approval: Check; at: Partial<Record<"connection" | "monitoring" | "blocking" | "approval", number>> }

const isTest = (a: Authorization, cmd: string) => a.tool === "shell" && (a.detail ?? "").startsWith(`Run: ${cmd}`);

/**
 * Each protection counts as working only once this agent's real records show it, after `since` (the start of a test, or 0 for all history):
 * connection  the agent made an authenticated call
 * monitoring  the agent reported a tool call it made (not TEND's own gateway record)
 * blocking    TEND refused the blocked test command, and no run of it was reported
 * approval    a person approved the approval test command, TEND spent that approval, and the run was reported, linked to it
 */
export function evidenceOf(agent: Pick<Agent, "id" | "lastSeenAt">, auths: Authorization[], events: TaskEvent[], since = 0): Evidence {
  const mine = auths.filter((a) => a.agentId === agent.id && a.createdAt >= since);
  const runs = events.filter((e) => e.agentId === agent.id && e.type === "tool.called" && e.via !== "gateway" && e.at >= since);
  const ran = (id: string) => runs.some((e) => e.authorizationId === id && e.outcome === "success");
  const blocked = mine.find((a) => isTest(a, TEST_COMMANDS.blocked) && a.status === "denied" && !runs.some((e) => e.authorizationId === a.id));
  const approved = mine.find((a) => isTest(a, TEST_COMMANDS.approval) && a.status === "consumed" && a.decidedAt !== undefined && a.reason === "approval_required" && ran(a.id));
  const reported = runs.at(-1);
  const seen = agent.lastSeenAt && agent.lastSeenAt >= since ? agent.lastSeenAt : undefined;
  return {
    connection: seen ? "working" : "not_verified",
    monitoring: reported ? "working" : "not_verified",
    blocking: blocked ? "working" : "not_verified",
    approval: approved ? "working" : "not_verified",
    at: { ...(seen && { connection: seen }), ...(reported && { monitoring: reported.at }), ...(blocked && { blocking: blocked.createdAt }), ...(approved && { approval: approved.decidedAt }) },
  };
}

/** The test command a person is being asked about right now, if it is waiting. */
export const pendingTest = (agentId: string, auths: Authorization[], now: number) =>
  auths.find((a) => a.agentId === agentId && a.status === "pending" && (a.expiresAt ?? 0) > now && isTest(a, TEST_COMMANDS.approval));
