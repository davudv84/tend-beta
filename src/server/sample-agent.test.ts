// The browser sample agent: simulated, harmless, and decided by the real policy, approval queue and audit log, exactly like a real agent.
import assert from "node:assert/strict";
import { test } from "node:test";
import { requestAuthorization } from "./authz.ts";
import { memoryDb } from "./db.ts";
import { HttpError } from "./http.ts";
import { allAgents, decide, getAgent, registerAgent, setPolicy } from "./repo.ts";
import { continueSample, SAMPLE_NAME, SAMPLE_RULES, startSample } from "./sample-agent.ts";

const ran = async (db: Awaited<ReturnType<typeof memoryDb>>, tool: string) =>
  (await db.all<{ data: string }>("SELECT data FROM events WHERE type = 'tool.called'")).map((r) => JSON.parse(r.data)).filter((d) => d.tool === tool);
const by = (steps: { tool: string; result: string }[]) => Object.fromEntries(steps.map((s) => [s.tool, s.result]));

test("one click: the read is allowed and runs, the email waits for a person, the delete is refused and never runs", async () => {
  const db = await memoryDb();
  const steps = await startSample(db, "operator-session-1");
  assert.deepEqual(by(steps), { read_demo_note: "ran", send_demo_email: "waiting", delete_demo_record: "denied" });
  assert.equal((await ran(db, "read_demo_note")).length, 1, "the allowed action ran once, and is in the audit log with its authorization");
  assert.ok((await ran(db, "read_demo_note"))[0].authorizationId);
  assert.equal((await ran(db, "send_demo_email")).length + (await ran(db, "delete_demo_record")).length, 0, "nothing else ran");
  assert.ok(!/tend_sk_/.test(JSON.stringify(steps)), "no key is ever returned");
  const agents = (await allAgents(db)).filter((a) => a.name === SAMPLE_NAME);
  assert.equal(agents.length, 1);
  assert.deepEqual(JSON.parse((await db.get<{ policy: string }>("SELECT policy FROM agents WHERE id = ?", agents[0].id))!.policy), SAMPLE_RULES);
});

test("after a person approves, continuing runs the email exactly once; continuing again runs nothing more", async () => {
  const db = await memoryDb();
  const steps = await startSample(db);
  const email = steps.find((s) => s.tool === "send_demo_email")!;
  await decide(db, email.id, "approved");
  assert.equal(by(await continueSample(db, steps.map((s) => s.id))).send_demo_email, "ran");
  assert.equal(by(await continueSample(db, steps.map((s) => s.id))).send_demo_email, "ran", "reported as ran, not run again");
  assert.equal((await ran(db, "send_demo_email")).length, 1, "exactly once");
});

test("a rejection means it never runs", async () => {
  const db = await memoryDb();
  const steps = await startSample(db);
  await decide(db, steps.find((s) => s.tool === "send_demo_email")!.id, "rejected");
  assert.equal(by(await continueSample(db, steps.map((s) => s.id))).send_demo_email, "rejected");
  assert.equal((await ran(db, "send_demo_email")).length, 0);
});

test("tightening the rule after an approval stops it; the operator's rule change is kept on the next run", async () => {
  const db = await memoryDb();
  const steps = await startSample(db);
  await decide(db, steps.find((s) => s.tool === "send_demo_email")!.id, "approved");
  const agent = (await allAgents(db)).find((a) => a.name === SAMPLE_NAME)!;
  await setPolicy(db, agent.id, SAMPLE_RULES.map((r) => (r.tool === "send_demo_email" ? { ...r, effect: "deny" } : r)), "enforce");
  assert.equal(by(await continueSample(db, steps.map((s) => s.id))).send_demo_email, "not_permitted");
  assert.equal((await ran(db, "send_demo_email")).length, 0);
  assert.equal(by(await startSample(db)).send_demo_email, "denied", "a new run follows the operator's rules, not the defaults");
});

test("continuing only ever touches the sample agent's own requests", async () => {
  const db = await memoryDb();
  await startSample(db);
  const other = await registerAgent(db, { name: "Real agent", model: "m", provider: "Anthropic" });
  await setPolicy(db, other.agent.id, [{ tool: "send_demo_email", action: "send", effect: "approve" }], "enforce");
  const theirs = (await requestAuthorization(db, (await getAgent(db, other.agent.id))!, { tool: "send_demo_email", action: "send", resource: "team-9" }, null)).view;
  await decide(db, theirs.id, "approved");
  assert.deepEqual(await continueSample(db, [theirs.id]), []);
  assert.equal((await db.get<{ status: string }>("SELECT status FROM authorizations WHERE id = ?", theirs.id))!.status, "approved", "another agent's approval is not spent");
  for (const bad of ["x", [1], Array.from({ length: 11 }, () => "az_x")]) await assert.rejects(() => continueSample(db, bad), (e) => e instanceof HttpError && e.code === "invalid_ids");
});

test("reporting where a run stands never runs anything", async () => {
  const db = await memoryDb();
  const steps = await startSample(db);
  await decide(db, steps.find((s) => s.tool === "send_demo_email")!.id, "approved");
  assert.equal(by(await continueSample(db, steps.map((s) => s.id), false)).send_demo_email, "approved");
  assert.equal((await ran(db, "send_demo_email")).length, 0, "only a deliberate continue runs it");
});

test("the sample agent's reports match what was approved: TEND raises no alert for a normal run", async () => {
  const db = await memoryDb();
  const steps = await startSample(db);
  await decide(db, steps.find((s) => s.tool === "send_demo_email")!.id, "approved");
  await continueSample(db, steps.map((s) => s.id));
  const alerts = (await db.all<{ data: string }>("SELECT data FROM events WHERE type = 'alert.raised'")).map((r) => JSON.parse(r.data).kind);
  assert.deepEqual(alerts, [], "no execution_differs, replay or unauthorized-execution alert");
});
