// A built-in sample agent, for trying TEND in the browser without running any code. It is SIMULATED: it asks TEND for three harmless demo
// actions through exactly the functions the agent API uses (requestAuthorization, claimToken, consumeAuthorization), so the real policy, the
// real approval queue and the real audit log decide and record everything. "Running" an action only records that it ran: nothing real
// happens, and no tool, file, network or credential is touched. Its key is never shown to anyone (the server acts for it directly), and
// only a signed-in operator can start or continue it (the route checks). One instance per tester keeps testers apart, as for real agents.
import type { Agent } from "../lib/types";
import { claimToken, consumeAuthorization, requestAuthorization } from "./authz.ts";
import type { DB } from "./db.ts";
import { HttpError } from "./http.ts";
import { allAgents, getAgent, ingestEvents, registerAgent, setPolicy } from "./repo.ts";
import { DEFAULT_WORKSPACE } from "./session.ts";

export const SAMPLE_NAME = "Sample agent (simulated)";
export const SAMPLE_RULES = [
  { tool: "read_demo_note", action: "read", effect: "allow" },
  { tool: "send_demo_email", action: "send", effect: "approve" },
  { tool: "delete_demo_record", action: "delete", effect: "deny" },
];
const ASKS = [
  { tool: "read_demo_note", action: "read", resource: "N-1", detail: "Read demo note N-1 (fictional)" },
  { tool: "send_demo_email", action: "send", resource: "team-1", detail: "Email to team-1 (fictional): subject Picnic; body The picnic is on Friday." },
  { tool: "delete_demo_record", action: "delete", resource: "R-7", detail: "Delete demo record R-7 (fictional)" },
];

export type SampleStep = { id: string; tool: string; action: string; resource: string; result: "ran" | "approved" | "denied" | "waiting" | "rejected" | "expired" | "cancelled" | "not_permitted" };

/** The sample agent, created on first use with the demo rules. Later runs keep whatever rules the operator gave it since. */
async function sampleAgent(db: DB, by: string | undefined, workspace: string): Promise<Agent> {
  const found = (await allAgents(db, workspace)).find((a) => a.origin === "connected" && a.name === SAMPLE_NAME && a.model === "simulated");
  if (found) return found;
  const { agent } = await registerAgent(db, { name: SAMPLE_NAME, model: "simulated", provider: "Custom", role: "Simulated: asks for harmless demo actions; nothing real happens" }, by, workspace);
  await setPolicy(db, agent.id, SAMPLE_RULES, "enforce", by);
  return (await getAgent(db, agent.id))!;
}

/** Spend an approved authorization the way a real agent must (token, then consume with the same request), then record that it "ran". */
async function run(db: DB, agent: Agent, id: string, ask: { tool: string; action: string; resource: string; detail: string }): Promise<SampleStep["result"]> {
  try {
    const claimed = (await claimToken(db, agent, id)).view;
    if (!("token" in claimed) || !claimed.token) return "waiting";
    await consumeAuthorization(db, agent, id, { token: claimed.token, ...ask });
  } catch (e) {
    const code = (e as { code?: string; extra?: { status?: string } }).code;
    const status = (e as { extra?: { status?: string } }).extra?.status;
    if (status === "rejected" || status === "expired" || status === "cancelled") return status;
    if (code === "not_permitted") return "not_permitted";
    throw e;
  }
  // The report repeats exactly what was approved (TEND cross-checks it and raises an alert on any difference).
  await ingestEvents(db, agent, [{ type: "tool.called", data: { tool: ask.tool, action: ask.action, resource: ask.resource, detail: ask.detail, outcome: "success", authorizationId: id } }]);
  return "ran";
}

/** Asks for the three demo actions. Allowed ones run at once; held ones wait for a person; refused ones never run. */
export async function startSample(db: DB, by?: string, workspace = DEFAULT_WORKSPACE): Promise<SampleStep[]> {
  const agent = await sampleAgent(db, by, workspace);
  const steps: SampleStep[] = [];
  for (const ask of ASKS) {
    const { view } = await requestAuthorization(db, agent, ask, null);
    const result = view.status === "approved" ? await run(db, agent, view.id, ask) : view.status === "pending" ? "waiting" : "denied";
    steps.push({ id: view.id, ...ask, result });
  }
  return steps;
}

/**
 * Continues the run whose ids the page holds, after a person decided: an approved request runs once; a rejected, expired or no longer allowed
 * one does not; one still waiting stays waiting. With `act` false it only reports (the page uses that when it is opened again).
 * Only the sample agent's own requests are looked at, whatever ids are sent.
 */
export async function continueSample(db: DB, ids: unknown, act = true, workspace = DEFAULT_WORKSPACE): Promise<SampleStep[]> {
  if (!Array.isArray(ids) || ids.length > 10 || ids.some((x) => typeof x !== "string")) throw new HttpError(422, "invalid_ids", "ids must be a list of up to 10 request ids.");
  const agent = (await allAgents(db, workspace)).find((a) => a.origin === "connected" && a.name === SAMPLE_NAME && a.model === "simulated");
  if (!agent) return [];
  const steps: SampleStep[] = [];
  for (const id of ids as string[]) {
    const r = await db.get<{ id: string; tool: string; action: string; resource: string; detail: string; status: string }>(
      "SELECT id, tool, action, resource, detail, status FROM authorizations WHERE id = ? AND agent_id = ?", id, agent.id);
    if (!r) continue;
    const ask = { tool: r.tool, action: r.action, resource: r.resource, detail: r.detail };
    const result: SampleStep["result"] = r.status === "approved" ? (act ? await run(db, agent, r.id, ask) : "approved")
      : r.status === "consumed" ? "ran" : r.status === "pending" ? "waiting" : (r.status as SampleStep["result"]);
    steps.push({ id: r.id, ...ask, result });
  }
  return steps;
}
