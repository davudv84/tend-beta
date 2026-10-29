// The permissions screen's guarantees: three choices become ordinary policy rules, the server re-validates them, spending
// can never skip a person, and what the screen shows is what the evaluator would decide. In-memory Postgres (PGlite).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent } from "../lib/types";
import { applyChoices, choiceOf, effectOf, type Choice, type RuleLike } from "../lib/permissions.ts";
import { claimToken } from "./authz.ts";
import { memoryDb, type DB } from "./db.ts";
import { requestExecution, toolCatalog } from "./gateway.ts";
import { policyView } from "./permissions.ts";
import { evaluate, NEVER_AUTOMATIC, type Rule } from "./policy.ts";
import { control, getAgent, registerAgent, setPolicy } from "./repo.ts";

const PAY = { invoice: "INV-1", amountCents: 500, currency: "EUR", payee: "PAYEE-1" };
const agentState: Pick<Agent, "status" | "integrationEnabled" | "permissions"> = { status: "active", integrationEnabled: true, permissions: [] };
const probe = (rules: Rule[], tool: string, action: string, resource: string | null = null) => evaluate(agentState, rules, { tool, action, resource, detail: null });

async function setup() {
  const db = await memoryDb();
  const { agent } = await registerAgent(db, { name: "Clerk", model: "m", provider: "Anthropic" });
  return { db, id: agent.id };
}
const failure = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return { code: (e as { code?: string }).code, status: (e as { status?: number }).status };
  }
  return { code: "ok", status: 200 };
};
const effects = async (db: DB, id: string) => Object.fromEntries((await policyView(db, id)).tools.map((t) => [t.tool, t.effect]));

test("the tools that spend money are exactly the ones no rule can automate", () => {
  const spend = toolCatalog().filter((t) => t.risk === "spend").map((t) => t.tool).sort();
  assert.deepEqual(spend, [...NEVER_AUTOMATIC].sort());
  assert.ok(spend.includes("pay_invoice"));
});

test("a rule that allows spending is treated as 'ask me first', whatever its shape", () => {
  for (const rule of [
    { tool: "pay_invoice", action: "execute", effect: "allow" },
    { tool: "pay_invoice", action: "*", effect: "allow" },
    { tool: "pay_invoice", action: "execute", resourcePrefix: "INV-", effect: "allow" },
  ] satisfies Rule[]) {
    const d = probe([rule], "pay_invoice", "execute", "INV-1");
    assert.deepEqual([d.effect, d.reason], ["approve", "approval_required"], JSON.stringify(rule));
  }
  assert.equal(probe([{ tool: "pay_invoice", action: "execute", effect: "deny" }], "pay_invoice", "execute").effect, "deny", "never is still never");
  assert.equal(probe([{ tool: "list_notes", action: "list", effect: "allow" }], "list_notes", "list").effect, "allow", "other tools can still be allowed");
});

test("saving a policy that lets spending run unattended is refused whole, and nothing changes or is logged", async () => {
  const { db, id } = await setup();
  try {
    const before = (await policyView(db, id)).version;
    const bad = await failure(() => setPolicy(db, id, [{ tool: "list_notes", action: "list", effect: "allow" }, { tool: "pay_invoice", action: "execute", effect: "allow" }], "enforce"));
    assert.deepEqual([bad.code, bad.status], ["spend_requires_approval", 422]);
    const view = await policyView(db, id);
    assert.deepEqual([view.version, view.rules, view.enforcement], [before, [], "monitor"], "not even the valid first rule was applied");
    assert.equal((await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM events WHERE type = 'policy.updated'"))!.n, 0);
    assert.equal((await failure(() => setPolicy(db, id, [{ tool: "pay_invoice", action: "execute", effect: "approve" }], "enforce"))).code, "ok");
    assert.equal((await failure(() => setPolicy(db, id, [{ tool: "pay_invoice", action: "execute", effect: "deny" }], "enforce"))).code, "ok");
  } finally {
    await db.close();
  }
});

test("a policy saved before this rule existed cannot make a payment run without a person", async () => {
  const { db, id } = await setup();
  try {
    await db.run("UPDATE agents SET policy = ? WHERE id = ?", JSON.stringify([{ tool: "pay_invoice", action: "execute", effect: "allow" }]), id);
    const agent = (await getAgent(db, id))!;
    const { view } = await requestExecution(db, agent, { tool: "pay_invoice", params: PAY }, null);
    assert.equal(view.status, "pending");
    assert.equal((await claimToken(db, agent, view.id)).view.status, "pending", "no token until a person decides");
    assert.equal((await policyView(db, id)).tools.find((t) => t.tool === "pay_invoice")!.effect, "approve", "and the screen says so");
  } finally {
    await db.close();
  }
});

test("a new agent is blocked everywhere: the safest setting is the default", async () => {
  const { db, id } = await setup();
  try {
    const view = await policyView(db, id);
    assert.deepEqual(view.tools.map((t) => t.tool).sort(), ["delete_test_file", "list_notes", "pay_invoice", "read_note", "read_test_file", "test_ping", "write_note", "write_test_file"]);
    assert.ok(view.tools.every((t) => t.effect === "deny" && !t.custom));
    assert.equal(view.valid, true);
    assert.deepEqual(view.rules, []);
  } finally {
    await db.close();
  }
});

test("what the screen shows is what the evaluator decides, and the choices really are enforced", async () => {
  const { db, id } = await setup();
  try {
    const view0 = await policyView(db, id);
    const rules = applyChoices(view0.rules, [
      { tool: "list_notes", action: "list", choice: "allow" },
      { tool: "read_note", action: "read", choice: "ask" },
      { tool: "write_note", action: "create", choice: "never" },
      { tool: "pay_invoice", action: "execute", choice: "ask" },
    ]);
    await setPolicy(db, id, rules, "enforce", undefined, view0.version);
    assert.deepEqual(await effects(db, id), { list_notes: "allow", read_note: "approve", write_note: "deny", pay_invoice: "approve", test_ping: "deny", read_test_file: "deny", write_test_file: "deny", delete_test_file: "deny" });

    const agent = (await getAgent(db, id))!;
    const ask = (tool: string, params: object) => requestExecution(db, agent, { tool, params }, null).then((r) => r.view);
    assert.equal((await ask("list_notes", {})).status, "approved", "allow: no person needed");
    assert.equal((await ask("read_note", { name: "standup" })).status, "pending", "ask me first: held for a person");
    const never = await ask("write_note", { name: "x", text: "y" });
    assert.deepEqual([never.status, never.reason], ["denied", "policy_denied"], "never: blocked");
    assert.equal((await ask("pay_invoice", PAY)).status, "pending");
  } finally {
    await db.close();
  }
});

test("rules the screen cannot show are reported as custom and survive an edit", async () => {
  const { db, id } = await setup();
  try {
    const custom: Rule[] = [
      { tool: "read_note", action: "read", resourcePrefix: "standup", effect: "allow" },
      { tool: "write_note", action: "*", effect: "approve" },
      { tool: "other_tool", action: "go", effect: "allow" },
    ];
    await setPolicy(db, id, custom, "enforce");
    const view = await policyView(db, id);
    const by = Object.fromEntries(view.tools.map((t) => [t.tool, t.custom]));
    // other_tool is the agent's own tool with a plain rule: listed, and editable with the three choices.
    assert.deepEqual(by, { pay_invoice: false, test_ping: false, list_notes: false, read_note: true, write_note: true, read_test_file: false, write_test_file: false, delete_test_file: false, other_tool: false });
    assert.deepEqual(view.tools.find((t) => t.tool === "other_tool"), { tool: "other_tool", action: "go", risk: "write", available: true, own: true, effect: "allow", source: "agent", custom: false });
    const rules = applyChoices(view.rules, [{ tool: "list_notes", action: "list", choice: "ask" }]);
    await setPolicy(db, id, rules, "enforce", undefined, view.version);
    assert.deepEqual((await policyView(db, id)).rules.filter((r) => r.tool !== "list_notes"), custom, "nothing else was touched");
  } finally {
    await db.close();
  }
});

test("an unreadable saved policy shows as blocked everywhere, and a paused agent still shows its real rules", async () => {
  const { db, id } = await setup();
  try {
    await setPolicy(db, id, [{ tool: "list_notes", action: "list", effect: "allow" }], "enforce");
    await control(db, id, "pause");
    assert.equal((await effects(db, id)).list_notes, "allow", "the rules are the rules, paused or not");
    await db.run("UPDATE agents SET policy = 'not json' WHERE id = ?", id);
    const view = await policyView(db, id);
    assert.equal(view.valid, false);
    assert.ok(view.tools.every((t) => t.effect === "deny"));
  } finally {
    await db.close();
  }
});

test("the server validates what the screen sends: bad rules, unknown fields and bad versions are refused whole", async () => {
  const { db, id } = await setup();
  try {
    const rule = { tool: "list_notes", action: "list", effect: "allow" };
    for (const [rules, code] of [
      [[{ ...rule, effect: "maybe" }], "invalid_policy"],
      [[{ ...rule, extra: 1 }], "invalid_policy"],
      [[{ ...rule, tool: "../x" }], "invalid_policy"],
      ["nope", "invalid_policy"],
      [Array.from({ length: 51 }, () => rule), "invalid_policy"],
    ] as const) assert.equal((await failure(() => setPolicy(db, id, rules, "enforce"))).code, code, JSON.stringify(rules).slice(0, 40));
    assert.equal((await failure(() => setPolicy(db, id, [rule], "off"))).code, "invalid_enforcement");
    assert.equal((await failure(() => setPolicy(db, id, [rule], "enforce", undefined, "1"))).code, "invalid_version");
    assert.deepEqual((await policyView(db, id)).rules, [], "nothing was applied");
  } finally {
    await db.close();
  }
});

test("a save made from an out-of-date view is refused instead of overwriting someone else's change", async () => {
  const { db, id } = await setup();
  try {
    const seen = (await policyView(db, id)).version;
    await setPolicy(db, id, [{ tool: "list_notes", action: "list", effect: "approve" }], "enforce"); // someone else
    const stale = await failure(() => setPolicy(db, id, [{ tool: "list_notes", action: "list", effect: "allow" }], "enforce", undefined, seen));
    assert.deepEqual([stale.code, stale.status], ["policy_changed", 409]);
    assert.equal((await effects(db, id)).list_notes, "approve", "their change stands");
    const now = (await policyView(db, id)).version;
    assert.equal((await failure(() => setPolicy(db, id, [{ tool: "list_notes", action: "list", effect: "allow" }], "enforce", undefined, now))).code, "ok");
    assert.equal((await effects(db, id)).list_notes, "allow");
  } finally {
    await db.close();
  }
});

test("the three choices map to the three effects and back; applyChoices leaves one plain rule per changed tool", () => {
  for (const c of ["allow", "ask", "never"] as Choice[]) assert.equal(choiceOf(effectOf(c)), c);
  const saved: RuleLike[] = [
    { tool: "a", action: "x", effect: "approve" },
    { tool: "a", action: "x", effect: "deny" }, // a duplicate: the screen replaces both with the one choice
    { tool: "a", action: "x", resourcePrefix: "p", effect: "allow" },
    { tool: "b", action: "y", effect: "deny" },
  ];
  const out = applyChoices(saved, [{ tool: "a", action: "x", choice: "allow" }]);
  assert.deepEqual(out, [saved[2], saved[3], { tool: "a", action: "x", effect: "allow" }]);
  assert.deepEqual(applyChoices(saved, []), saved);
});
