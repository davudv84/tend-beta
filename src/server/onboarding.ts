// First-run setup, kept per account on the server. The row remembers where the person is (so they can leave and come back) and which agent
// they set up. Everything the checklist says is worked out from that agent's real records every time it is asked: whether TEND has seen an
// authenticated call, the policy actually saved, and the test action's outcome as the gateway recorded it. Setup counts as completed only
// when the server has seen TEND decide a real test action; a person who does not want to finish skips it, which is recorded as a skip.
import { presetOf } from "../lib/agent-presets.ts";
import { INTEGRATIONS } from "../lib/integrations-catalog.ts";
import { TEST_TOOL } from "../lib/onboarding.ts";
import type { Q } from "./db.ts";
import { HttpError } from "./http.ts";
import type { Session } from "./session.ts";

export const STEPS = ["welcome", "connect", "verify", "policy", "test", "notifications", "done"] as const;
export type Step = (typeof STEPS)[number];
const INTEGRATION_IDS = new Set<string>(INTEGRATIONS.filter((i) => i.connect).map((i) => i.id));

interface Row { user_id: string; step: Step; integration: string | null; agent_id: string | null; notifications: "enabled" | "later" | null; started_at: number; updated_at: number; completed_at: number | null; skipped_at: number | null }
interface AgentRow { id: string; profile: string; last_seen_at: number | null; policy: string; enforcement: string }
type Outcome = "ran" | "rejected" | "blocked";

/** The test action's latest decided outcome for this agent, from its authorizations and the gateway's own record of running it. */
async function testOutcome(q: Q, agentId: string): Promise<{ outcome: Outcome; at: number; authorizationId: string } | null> {
  // The test action is the gateway's test ping (the test script), or one of the harmless test commands an assistant connected through hooks
  // is asked to run (src/lib/agent-presets.ts TEST_COMMANDS: the hook files them as shell requests whose detail is "Run: <command>").
  const a = await q.get<{ id: string; tool: string; status: string; created_at: number; decided_at: number | null; consumed_at: number | null }>(
    `SELECT id, tool, status, created_at, decided_at, consumed_at FROM authorizations
     WHERE agent_id = ? AND (tool = ? OR (tool = 'shell' AND detail IN ('Run: echo tend-activity-test', 'Run: echo tend-blocked-test', 'Run: echo tend-approval-test')))
     ORDER BY created_at DESC LIMIT 1`, agentId, TEST_TOOL);
  if (!a) return null;
  if (a.status === "denied") return { outcome: "blocked", at: a.created_at, authorizationId: a.id };
  if (a.status === "rejected") return { outcome: "rejected", at: a.decided_at ?? a.created_at, authorizationId: a.id };
  if (a.status !== "consumed") return null;
  // Spent is not proof it ran. For the test ping, TEND's gateway ran it and recorded that (actor system, via gateway). For an assistant's own
  // tool, the assistant ran it, so the proof is its post-tool hook's report linked to this authorization.
  const ran = await q.get<{ at: number }>(
    a.tool === TEST_TOOL
      ? "SELECT at FROM events WHERE agent_id = ? AND type = 'tool.called' AND actor = 'system' AND (data::jsonb->>'via') = 'gateway' AND (data::jsonb->>'authorizationId') = ? AND (data::jsonb->>'outcome') = 'success' LIMIT 1"
      : "SELECT at FROM events WHERE agent_id = ? AND type = 'tool.called' AND actor = 'agent' AND (data::jsonb->>'authorizationId') = ? AND (data::jsonb->>'outcome') = 'success' LIMIT 1",
    agentId, a.id);
  return ran ? { outcome: "ran", at: ran.at, authorizationId: a.id } : null;
}

/** The saved rule for the test action, if it is a plain one: what the person chose in the policy step. */
function testRule(policy: string) {
  try {
    const rules = JSON.parse(policy) as { tool?: string; action?: string; effect?: string; resourcePrefix?: string; permission?: string; when?: unknown }[];
    const r = rules.find((x) => x.tool === TEST_TOOL && x.action === "ping" && x.resourcePrefix === undefined && x.permission === undefined && x.when === undefined);
    return r && ["allow", "approve", "deny"].includes(r.effect ?? "") ? (r.effect as "allow" | "approve" | "deny") : null;
  } catch {
    return null;
  }
}

/** The ready-made policy for coding assistants that the saved rules are, if they are exactly one (src/lib/agent-presets.ts). */
function presetOfSaved(policy: string) {
  try { return presetOf(JSON.parse(policy)); } catch { return null; }
}

export async function onboardingView(q: Q, s: Session) {
  if (!s.userId) return { available: false as const };
  const row = await q.get<Row>("SELECT * FROM onboarding WHERE user_id = ?", s.userId);
  // Only an agent of this workspace counts, whatever the row says.
  const agent = row?.agent_id ? await q.get<AgentRow>("SELECT id, profile, last_seen_at, policy, enforcement FROM agents WHERE id = ? AND workspace_id = ? AND origin = 'connected'", row.agent_id, s.workspace) : undefined;
  const effect = agent && agent.enforcement === "enforce" ? testRule(agent.policy) : null;
  const preset = agent && agent.enforcement === "enforce" ? presetOfSaved(agent.policy) : null;
  const test = agent ? await testOutcome(q, agent.id) : null;
  return {
    available: true as const,
    step: row?.step ?? "welcome",
    integration: row?.integration ?? null,
    agent: agent ? { id: agent.id, name: (JSON.parse(agent.profile) as { name: string }).name } : null,
    startedAt: row?.started_at ?? null,
    completedAt: row?.completed_at ?? null,
    skippedAt: row?.skipped_at ?? null,
    checks: {
      agent: !!agent,
      connectedAt: agent?.last_seen_at ?? null,
      policy: effect,
      preset,
      test,
      notifications: row?.notifications ?? null,
    },
  };
}

/** Whether Home should send this person to the setup guide: an account that has neither finished nor skipped it, and that either started it or has no connected agent yet (people who set up agents before the guide existed are not interrupted). */
export async function shouldOnboard(q: Q, s: Session) {
  if (!s.userId) return false;
  const row = await q.get<Row>("SELECT completed_at, skipped_at FROM onboarding WHERE user_id = ?", s.userId);
  if (row) return row.completed_at === null && row.skipped_at === null;
  return !(await q.get("SELECT 1 FROM agents WHERE workspace_id = ? AND origin = 'connected' LIMIT 1", s.workspace));
}

const now = () => Date.now();

/** Upserts the row. Column names come from this file only (the keys of `fields`), never from a request. */
async function save(q: Q, userId: string, fields: Partial<Omit<Row, "user_id" | "started_at" | "updated_at">>, at: number) {
  const cols = (Object.keys(fields) as (keyof typeof fields)[]).filter((c) => c !== "step");
  const set = [...(fields.step ? ["step"] : []), ...cols].map((c) => `, ${c} = EXCLUDED.${c}`).join("");
  await q.run(
    `INSERT INTO onboarding (user_id, step, started_at, updated_at${cols.map((c) => `, ${c}`).join("")}) VALUES (?, ?, ?, ?${cols.map(() => ", ?").join("")})
     ON CONFLICT (user_id) DO UPDATE SET updated_at = EXCLUDED.updated_at${set}`,
    userId, fields.step ?? "welcome", at, at, ...cols.map((c) => fields[c] ?? null));
}

/**
 * progress  { step, integration?, agentId?, notifications? }: where the person is now. Resuming after a skip clears the skip.
 * skip      leaves the guide; Home stops sending the person here. Settings can restart it.
 * restart   back to the first step (agents and policies are kept; nothing is deleted).
 * complete  only once the server has seen TEND decide a real test action from the chosen agent.
 */
export async function updateOnboarding(q: Q, s: Session, body: unknown, at = now()) {
  if (!s.userId) throw new HttpError(409, "account_required", "The setup guide belongs to an account. Sign in with your e-mail address.");
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  switch (o.action) {
    case "progress": {
      if (typeof o.step !== "string" || !(STEPS as readonly string[]).includes(o.step) || o.step === "done") throw new HttpError(422, "invalid_request", "step must be one of welcome, connect, verify, policy, test, notifications.");
      const fields: Parameters<typeof save>[2] = { step: o.step as Step, skipped_at: null };
      if (o.integration !== undefined) {
        if (typeof o.integration !== "string" || !INTEGRATION_IDS.has(o.integration)) throw new HttpError(422, "invalid_request", "Unknown integration.");
        fields.integration = o.integration;
      }
      if (o.agentId !== undefined) {
        if (typeof o.agentId !== "string" || !(await q.get("SELECT 1 FROM agents WHERE id = ? AND workspace_id = ? AND origin = 'connected'", o.agentId, s.workspace)))
          throw new HttpError(404, "agent_not_found", "No agent with that id.");
        fields.agent_id = o.agentId;
      }
      if (o.notifications !== undefined) {
        if (o.notifications !== "enabled" && o.notifications !== "later") throw new HttpError(422, "invalid_request", "notifications must be enabled or later.");
        fields.notifications = o.notifications;
      }
      await save(q, s.userId, fields, at);
      break;
    }
    case "skip":
      await save(q, s.userId, { skipped_at: at, step: ((await q.get<Row>("SELECT step FROM onboarding WHERE user_id = ?", s.userId))?.step ?? "welcome") }, at);
      break;
    case "restart":
      await q.run("DELETE FROM onboarding WHERE user_id = ?", s.userId);
      await save(q, s.userId, { step: "welcome" }, at);
      break;
    case "complete": {
      const v = await onboardingView(q, s);
      if (!v.available || !v.checks.test) throw new HttpError(409, "onboarding_incomplete", "TEND has not yet seen your agent's test action. Run the test, then finish.");
      await save(q, s.userId, { step: "done", completed_at: at, skipped_at: null }, at);
      break;
    }
    default:
      throw new HttpError(422, "invalid_request", "action must be progress, skip, restart or complete.");
  }
  return onboardingView(q, s);
}
