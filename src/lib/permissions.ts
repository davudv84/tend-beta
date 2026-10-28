// The permissions screen's three choices, and how they turn into the policy rules the server already understands.
// Pure and free of server imports, so the browser and the tests share it. The server validates everything again.

export type Effect = "allow" | "approve" | "deny";
export type Choice = "allow" | "ask" | "never";
export type Risk = "read" | "write" | "spend" | "test";

export interface RuleLike { tool: string; action: string; resourcePrefix?: string; effect: Effect; permission?: string }

/** GET /api/v1/agents/{id}/policy: the saved policy, and the decision the server would make for each tool. */
export interface PolicyView {
  agentId: string;
  version: number;
  enforcement: "monitor" | "enforce";
  /** False when the saved policy cannot be read; the server then denies everything. */
  valid: boolean;
  rules: RuleLike[];
  tools: { tool: string; action: string; risk: Risk; available: boolean; effect: Effect; custom: boolean }[];
}

export const choiceOf = (e: Effect): Choice => (e === "allow" ? "allow" : e === "approve" ? "ask" : "never");
export const effectOf = (c: Choice): Effect => (c === "allow" ? "allow" : c === "ask" ? "approve" : "deny");

/**
 * The rules after the owner changed some tools. Each changed tool gets exactly one plain rule; every other rule is kept
 * untouched, including the ones this screen cannot show (a resource prefix, a permission, another action or tool).
 */
export function applyChoices(saved: RuleLike[], changes: { tool: string; action: string; choice: Choice }[]): RuleLike[] {
  const plain = (r: RuleLike) => r.resourcePrefix === undefined && r.permission === undefined;
  const kept = saved.filter((r) => !(plain(r) && changes.some((c) => c.tool === r.tool && c.action === r.action)));
  return [...kept, ...changes.map((c) => ({ tool: c.tool, action: c.action, effect: effectOf(c.choice) }))];
}
