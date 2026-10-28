// Where a new agent's connection test stands, worked out only from what Tend has really recorded: the agent's last
// authenticated call, its authorizations and the gateway's outcome events. Nothing here is assumed or simulated.
import type { Agent, Authorization, TaskEvent } from "./types";

export const TEST_TOOL = "test_ping";

export type TestState =
  | { kind: "waiting_connection" }
  | { kind: "connected" }
  | { kind: "blocked"; auth: Authorization }
  | { kind: "pending"; auth: Authorization }
  | { kind: "approved"; auth: Authorization }
  | { kind: "running"; auth: Authorization }
  | { kind: "verified"; auth: Authorization; event: TaskEvent }
  | { kind: "failed"; auth: Authorization; event: TaskEvent }
  | { kind: "rejected"; auth: Authorization }
  | { kind: "closed"; auth: Authorization };

/** `after`: ignore test requests made before this time (the screen sets it when the person starts, or restarts, the test). */
export function testState(agent: Agent | undefined, auths: Authorization[], events: TaskEvent[], now: number, after = 0): TestState {
  // lastSeenAt is only ever set by a request that carried this agent's key.
  if (!agent?.lastSeenAt) return { kind: "waiting_connection" };
  const mine = auths.filter((a) => a.agentId === agent.id && a.tool === TEST_TOOL && a.createdAt >= Math.max(agent.connectedAt, after));
  const auth = mine.reduce<Authorization | undefined>((best, a) => (!best || a.createdAt > best.createdAt ? a : best), undefined);
  if (!auth) return { kind: "connected" };
  const lapsed = (auth.status === "pending" || auth.status === "approved") && auth.expiresAt !== undefined && auth.expiresAt <= now;
  switch (lapsed ? "expired" : auth.status) {
    case "denied": return { kind: "blocked", auth };
    case "pending": return { kind: "pending", auth };
    case "approved": return { kind: "approved", auth };
    case "rejected": return { kind: "rejected", auth };
    case "consumed": {
      // Only the gateway's own record of this authorization counts as proof that Tend ran it.
      const event = events.find((e) => e.type === "tool.called" && e.authorizationId === auth.id && e.via === "gateway");
      if (!event) return { kind: "running", auth };
      return event.outcome === "success" ? { kind: "verified", auth, event } : { kind: "failed", auth, event };
    }
    default: return { kind: "closed", auth };
  }
}
