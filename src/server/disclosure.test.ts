// What visitors and signed-out users can and cannot read. A public instance shows visitors the activity of demo agents and
// of connected agents an operator marked public. It must never show them settings, operator session ids, key fragments or
// verification results, through either read path (the snapshot and the incremental events).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Viewer } from "./auth.ts";
import { sessionCookieName, viewerOf } from "./session.ts";
import { signedIn } from "./test-support.ts";
import { memoryDb, type DB } from "./db.ts";
import { PROTOCOL } from "../lib/contract.ts";
import { requestAuthorization } from "./authz.ts";
import { seedDemo } from "./demo.ts";
import { requestExecution } from "./gateway.ts";
import { HttpError } from "./http.ts";
import { control, decide, getAgent, ingestCheckIn, ingestEvents, insertEvent, registerAgent, rotateKey, setPolicy } from "./repo.ts";
import { since, snapshot } from "./sync.ts";

process.env.TEND_ADMIN_TOKEN = "test-admin-token-0123456789abcdef";
process.env.TEND_DEMO = "0";

const SID = "0123456789abcdef";
/** Only in the policy, never asked for: so if it shows up, a policy leaked (what an agent asks for is activity and is visible). */
const SECRET_TOOL = "confidential_tool_x9";
const ASKED_TOOL = "asked_tool";
const asVisitor = (db: DB) => viewerOf(db, new Request("http://tend.test/"));
const asOperator = async (db: DB) => viewerOf(db, (await signedIn(db)).request());

/** Every key name anywhere in a value. */
const keysDeep = (v: unknown): string[] => (v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]) : []);

async function publicAgentWithHistory() {
  const db = await memoryDb();
  const { agent } = await registerAgent(db, { name: "Public Clerk", model: "m", provider: "Custom", public: true }, SID);
  await setPolicy(db, agent.id, [{ tool: ASKED_TOOL, action: "go", effect: "approve" }, { tool: SECRET_TOOL, action: "go", effect: "deny" }], "enforce", SID);
  const a = (await getAgent(db, agent.id))!;
  const { view } = await requestAuthorization(db, a, { tool: ASKED_TOOL, action: "go" }, null);
  await decide(db, view.id, "approved", undefined, SID);
  await control(db, agent.id, "pause", undefined, SID);
  await control(db, agent.id, "resume", undefined, SID);
  const { prefix } = await rotateKey(db, agent.id, SID);
  await db.tx((q) => insertEvent(q, { agentId: agent.id, type: "verification.run", actor: "human", data: { runId: "vr_1", verified: 3, atRisk: 1, notVerified: 2, by: SID } }));
  return { db, id: agent.id, prefix };
}
const read = async (db: DB, viewer: Viewer) => ({ since: await since(db, viewer, 0), snapshot: await snapshot(db, viewer) });

test("visitors of a public instance never receive policies, enforcement, session ids, key fragments or verification results", async () => {
  process.env.TEND_PUBLIC = "1";
  const { db, prefix } = await publicAgentWithHistory();
  try {
    const out = await read(db, (await asVisitor(db)));
    const text = JSON.stringify(out);
    for (const secret of [SID, SECRET_TOOL, prefix, "vr_1"]) assert.equal(text.includes(secret), false, `a visitor can read ${secret === SID ? "an operator session id" : secret === prefix ? "a key fragment" : secret}`);
    const keys = keysDeep(out);
    for (const k of ["by", "policy", "enforcement", "prefix", "verified", "atRisk", "notVerified"]) assert.equal(keys.includes(k), false, `field "${k}" reached a visitor`);
    assert.equal("keys" in out.snapshot, false, "key prefixes are for operators");
    assert.equal(out.since.events.some((e) => e.type === "verification.run"), false);
  } finally {
    await db.close();
  }
});

test("visitors still see the activity: that a policy changed, and what was asked and decided", async () => {
  process.env.TEND_PUBLIC = "1";
  const { db } = await publicAgentWithHistory();
  try {
    const { events } = await since(db, (await asVisitor(db)), 0);
    const types = events.map((e) => e.type);
    for (const t of ["agent.registered", "policy.updated", "authorization.requested", "review.decided", "agent.paused", "agent.resumed", "key.rotated"]) assert.ok(types.includes(t as never), `${t} is missing`);
    assert.deepEqual(Object.keys(events.find((e) => e.type === "policy.updated")!.data), ["version"], "only that it changed");
    assert.equal(events.find((e) => e.type === "review.decided")!.data.status, "approved");
    assert.deepEqual(events.find((e) => e.type === "key.rotated")!.data, {});
  } finally {
    await db.close();
  }
});

test("operators still see everything, so nothing is lost for the people who need it", async () => {
  process.env.TEND_PUBLIC = "1";
  const { db, prefix } = await publicAgentWithHistory();
  try {
    const { events } = await since(db, (await asOperator(db)), 0);
    const policy = events.find((e) => e.type === "policy.updated")!.data;
    assert.deepEqual([policy.by, policy.enforcement, (policy.policy as { tool: string }[]).map((r) => r.tool).includes(SECRET_TOOL)], [SID, "enforce", true]);
    assert.equal(events.find((e) => e.type === "key.rotated")!.data.prefix, prefix);
    assert.ok(events.some((e) => e.type === "verification.run"));
    assert.ok("keys" in (await snapshot(db, (await asOperator(db)))));
  } finally {
    await db.close();
  }
});

test("a private instance gives signed-out users nothing at all", async () => {
  process.env.TEND_PUBLIC = "0";
  const { db } = await publicAgentWithHistory();
  try {
    for (const read of [async () => since(db, await asVisitor(db), 0), async () => snapshot(db, await asVisitor(db))])
      await assert.rejects(read(), (e) => e instanceof HttpError && e.status === 401 && e.code === "sign_in_required");
    assert.ok((await since(db, (await asOperator(db)), 0)).events.length > 0, "operators are unaffected");
  } finally {
    process.env.TEND_PUBLIC = "1";
    await db.close();
  }
});

test("agents an operator did not mark public are not visible to visitors at all", async () => {
  process.env.TEND_PUBLIC = "1";
  const db = await memoryDb();
  try {
    const { agent } = await registerAgent(db, { name: "Private Clerk", model: "m", provider: "Custom" }, SID);
    await setPolicy(db, agent.id, [{ tool: SECRET_TOOL, action: "go", effect: "approve" }], "enforce", SID);
    const text = JSON.stringify(await read(db, (await asVisitor(db))));
    assert.equal(text.includes(agent.id) || text.includes(SECRET_TOOL) || text.includes(SID), false);
  } finally {
    await db.close();
  }
});

// ---- private content: requests, invoices, customer notes, operator comments, error text, free text ----------------------

/** Everything a business would not want strangers to read. None of it may reach a visitor. */
const PRIVATE = [
  "Mueller", "4711", "contract-4711", "CFO said yes", "Baumann", "INV-2041", "hunter2", "SECRET-FEEDBACK", "SECRET-CONTEXT", "SECRET-REFLECTION",
  "payroll-PR9", "EUR 480", "Paused because", "SECRET-REASON", "10.0.0.5",
];
const answers = {
  instructions: { answer: "yes", confidence: 90, explanation: "SECRET-EXPLANATION-4471" }, context: { answer: "yes", confidence: 80 }, conflicts: { answer: "no", confidence: 85 },
  review: { answer: "no", confidence: 95 }, improvements: { answer: "yes", confidence: 70 },
};

async function agentWithPrivateActivity() {
  const db = await memoryDb();
  const { agent, apiKey } = await registerAgent(db, { name: "Public Clerk", model: "m", provider: "Custom", public: true }, SID);
  await setPolicy(db, agent.id, [{ tool: "write_note", action: "create", effect: "approve" }, { tool: "pay_invoice", action: "execute", effect: "approve" }], "enforce", SID);
  const a = (await getAgent(db, agent.id))!;
  const { view } = await requestExecution(db, a, { tool: "write_note", params: { name: "contract-4711", text: "Call Frau Mueller about contract 4711, EUR 480" } }, null);
  await decide(db, view.id, "approved", "CFO said yes, keep quiet", SID);
  await ingestEvents(db, a, [
    { type: "task.started", data: { taskId: "t1", title: "Call customer Mueller", detail: "contract 4711" } },
    { type: "task.completed", data: { taskId: "t1", summary: "Mueller agreed to the Baumann terms" } },
    // Reported as success with no authorization in enforce mode: raises an alert that carries the resource.
    { type: "tool.called", data: { tool: "pay_invoice", action: "execute", outcome: "success", resource: "INV-2041", detail: "EUR 480 to Baumann" } },
    { type: "tool.called", data: { tool: "send_mail", action: "send", outcome: "failure", error: "ECONNRESET 10.0.0.5 password=hunter2" } },
    { type: "review.requested", data: { reason: "Need payroll-PR9 access" } },
  ]);
  await ingestCheckIn(db, a, {
    protocol: PROTOCOL, responses: answers, feedback: "SECRET-FEEDBACK", context: "SECRET-CONTEXT", reflection: "SECRET-REFLECTION",
    proposedAdjustment: { kind: "permission", title: "payroll-PR9 access", permission: "payroll.read" },
  }, "agent");
  await control(db, agent.id, "pause", "Paused because of the Mueller incident", SID);
  await control(db, agent.id, "resume", undefined, SID);
  await ingestEvents(db, (await getAgent(db, agent.id))!, [{ type: "agent.disconnected", data: { reason: "SECRET-REASON" } }]);
  return { db, id: agent.id, key: apiKey, authorizationId: view.id };
}

test("a public connected agent shows visitors the shape of its activity, never what was in it", async () => {
  process.env.TEND_PUBLIC = "1";
  const { db } = await agentWithPrivateActivity();
  try {
    const out = await read(db, (await asVisitor(db)));
    const text = JSON.stringify(out);
    for (const secret of PRIVATE) assert.equal(text.includes(secret), false, `a visitor can read "${secret}"`);
    for (const k of ["resource", "detail", "feedback", "note", "error", "summary", "reflection", "adjustment", "reason" /* free text; codes are named differently below */])
      if (k !== "reason") assert.equal(keysDeep(out.since.events).includes(k), false, `field "${k}" reached a visitor in an event`);

    // The demonstration is still useful: what happened, to which tool, with what outcome.
    const ev = out.since.events;
    const by = (t: string) => ev.filter((e) => e.type === t);
    assert.deepEqual(by("authorization.requested").map((e) => [e.data.tool, e.data.action, e.data.status]), [["write_note", "create", "pending"]]);
    assert.equal(by("review.decided")[0].data.status, "approved");
    assert.deepEqual(by("tool.called").map((e) => [e.data.tool, e.data.outcome]), [["pay_invoice", "success"], ["send_mail", "failure"]]);
    assert.deepEqual(by("alert.raised").map((e) => [e.data.kind, e.data.tool]), [["unauthorized_execution", "pay_invoice"]]);
    assert.equal(by("task.started")[0].data.title, "Task", "a neutral title, not the agent's own words");
    assert.deepEqual(Object.keys(by("check_in")[0].data), ["responses"]);
    assert.deepEqual(Object.keys(by("agent.paused")[0].data), ["version"]);
    assert.deepEqual(by("agent.disconnected")[0].data, {});
    assert.deepEqual(by("review.requested")[0].data, {});

    // And the dashboard's own view of it, built from the same events.
    const proj = out.snapshot.projection;
    const az = proj.authorizations.find((a) => a.tool === "write_note")!;
    assert.deepEqual([az.status, az.detail, az.resource, az.note], ["approved", undefined, undefined, undefined]);
    assert.ok(proj.checkIns.every((c) => c.feedback === "" && c.context === "" && !c.reflection && !c.adjustment));
    assert.ok(proj.checkIns.length > 0 && Object.keys(proj.checkIns[0].responses).length === 5, "the structured answers remain");
  } finally {
    await db.close();
  }
});

test("operators still see all of it: nothing is lost for the people who need it", async () => {
  process.env.TEND_PUBLIC = "1";
  const { db } = await agentWithPrivateActivity();
  try {
    const text = JSON.stringify(await read(db, (await asOperator(db))));
    for (const secret of ["Mueller", "hunter2", "CFO said yes", "INV-2041", "SECRET-FEEDBACK", "Paused because", "payroll-PR9"]) assert.ok(text.includes(secret), `operators lost "${secret}"`);
  } finally {
    await db.close();
  }
});

test("the public demonstration keeps its invented sample text: demo agents are fictional by construction", async () => {
  process.env.TEND_PUBLIC = "1";
  process.env.TEND_DEMO = "1";
  const db = await memoryDb();
  try {
    await seedDemo(db, Date.now());
    const out = await read(db, (await asVisitor(db)));
    const proj = out.snapshot.projection;
    assert.ok(proj.agents.every((a) => a.origin === "demo") && proj.agents.length > 0);
    assert.ok(proj.checkIns.filter((c) => c.feedback.length > 20).length > 10, "demo check-ins still read like real ones");
    assert.ok(out.since.events.some((e) => typeof e.data.feedback === "string" && e.data.feedback.length > 20), "and the demo events keep their text");
    assert.ok(proj.log.some((l) => l.note), "and its decisions keep their notes");
  } finally {
    process.env.TEND_DEMO = "0";
    await db.close();
  }
});

test("what an operator does to a demo agent live is not sample text: their comments, notes and hand-written check-ins stay private", async () => {
  process.env.TEND_PUBLIC = "1";
  process.env.TEND_DEMO = "1";
  const db = await memoryDb();
  try {
    await seedDemo(db, Date.now());
    const demoId = (await db.get<{ id: string }>("SELECT id FROM agents WHERE origin = 'demo' ORDER BY id LIMIT 1"))!.id;
    const pending = (await db.get<{ id: string }>("SELECT id FROM reviews WHERE status = 'pending' LIMIT 1"))!.id;
    await decide(db, pending, "approved", "PRIVATE-DEMO-COMMENT", SID);
    await ingestCheckIn(db, (await getAgent(db, demoId))!, { protocol: PROTOCOL, responses: answers, feedback: "PRIVATE-COMPOSED-FEEDBACK", context: "PRIVATE-COMPOSED-CONTEXT" }, "human");
    await control(db, demoId, "pause", "PRIVATE-DEMO-PAUSE-NOTE", SID);

    const visitor = await read(db, (await asVisitor(db)));
    const text = JSON.stringify(visitor);
    for (const secret of ["PRIVATE-DEMO-COMMENT", "PRIVATE-DEMO-PAUSE-NOTE", "PRIVATE-COMPOSED-FEEDBACK", "PRIVATE-COMPOSED-CONTEXT", SID]) assert.equal(text.includes(secret), false, `a visitor can read ${secret}`);
    assert.ok(visitor.snapshot.projection.checkIns.filter((c) => c.feedback.length > 20).length > 10, "the seeded demo text is still there");
    assert.ok(visitor.snapshot.projection.log.some((l) => l.note), "including the seeded decisions' notes");
    const operator = JSON.stringify(await read(db, (await asOperator(db))));
    for (const secret of ["PRIVATE-DEMO-COMMENT", "PRIVATE-DEMO-PAUSE-NOTE", "PRIVATE-COMPOSED-FEEDBACK"]) assert.ok(operator.includes(secret), `operators lost ${secret}`);
  } finally {
    process.env.TEND_DEMO = "0";
    await db.close();
  }
});

test("an event type nobody has listed shows a visitor nothing at all, so a future field can't leak by default", async () => {
  process.env.TEND_PUBLIC = "1";
  const { db, id } = await agentWithPrivateActivity();
  try {
    await db.tx((q) => insertEvent(q, { agentId: id, type: "future.event" as never, actor: "system", data: { secret: "SECRET-FUTURE", by: SID, resource: "x" } }));
    const events = (await since(db, (await asVisitor(db)), 0)).events;
    const future = events.find((e) => (e.type as string) === "future.event")!;
    assert.deepEqual(future.data, {});
    assert.equal(JSON.stringify(events).includes("SECRET-FUTURE"), false);
    // A field added to a known event later is hidden too, until someone lists it.
    await db.tx((q) => insertEvent(q, { agentId: id, type: "tool.called", actor: "agent", data: { tool: "t", action: "a", outcome: "success", newField: "SECRET-NEWFIELD" } }));
    assert.equal(JSON.stringify((await since(db, (await asVisitor(db)), 0)).events).includes("SECRET-NEWFIELD"), false);
  } finally {
    await db.close();
  }
});

test("signed-out users and agents' keys get no more than a visitor: nothing on a private instance, only the shape on a public one", async () => {
  const { db, key } = await agentWithPrivateActivity();
  try {
    const viewers = async () => ({
      visitor: await asVisitor(db),
      withKey: await viewerOf(db, new Request("http://tend.test/", { headers: { authorization: `Bearer ${key}` } })),
      forged: await viewerOf(db, new Request("http://tend.test/", { headers: { cookie: `${sessionCookieName()}=0123456789abcdef.${"A".repeat(43)}` } })),
      oldFormat: await viewerOf(db, new Request("http://tend.test/", { headers: { cookie: `${sessionCookieName()}=${Date.now() + 3_600_000}.0123456789abcdef.forged` } })),
    });
    process.env.TEND_PUBLIC = "1";
    const open = await viewers();
    for (const [who, v] of Object.entries(open)) {
      assert.deepEqual([v.role, v.canAct], ["visitor", false], `${who} must not be an operator`);
      for (const secret of PRIVATE) assert.equal(JSON.stringify(await read(db, v)).includes(secret), false, `${who} can read "${secret}"`);
    }
    process.env.TEND_PUBLIC = "0"; // viewers are built per request, so build them after the instance is private
    for (const [who, v] of Object.entries(await viewers()))
      for (const fn of [() => since(db, v, 0), () => snapshot(db, v)])
        await assert.rejects(fn(), (e) => e instanceof HttpError && e.status === 401, `${who} got data from a private instance`);
  } finally {
    process.env.TEND_PUBLIC = "1";
    await db.close();
  }
});

test("a visitor sees a check-in's answers and confidences, never the free-text explanation an agent wrote with them", async () => {
  process.env.TEND_PUBLIC = "1";
  const { db } = await agentWithPrivateActivity();
  try {
    const out = await read(db, (await asVisitor(db)));
    const blob = JSON.stringify(out);
    assert.equal(blob.includes("SECRET-EXPLANATION-4471"), false, "the explanation reached a visitor");
    assert.equal(keysDeep(out.since.events).includes("explanation"), false);
    assert.equal(keysDeep(out.snapshot.projection).includes("explanation"), false);
    const c = out.since.events.find((e) => e.type === "check_in")!.data.responses as Record<string, Record<string, unknown>>;
    assert.deepEqual(Object.keys(c.instructions).sort(), ["answer", "confidence"], "the structured answer and confidence remain");
  } finally {
    await db.close();
  }
});

// From the security review of 2026-10-31: the person deciding saw only the 200-character detail, while the approval was bound to the whole
// command. A pending request now carries its exact command, path or URL to operators; visitors never receive it.
test("a pending hook request shows operators its whole command; visitors of a public instance never get it", async () => {
  const db = await memoryDb();
  const { agent } = await registerAgent(db, { name: "Public Coder", model: "Claude Code", provider: "Anthropic", public: true }, SID);
  await setPolicy(db, agent.id, [{ tool: "shell", action: "*", effect: "approve" }], "enforce", SID);
  const command = `echo ${"a".repeat(400)} ; git push --force`;
  const a = (await getAgent(db, agent.id))!;
  const { view } = await requestAuthorization(db, a, { tool: "shell", action: "Bash", detail: `Run: ${command.slice(0, 150)}…`, args: { command } }, null);
  const op = (await snapshot(db, await asOperator(db))).projection.authorizations.find((x) => x.id === view.id);
  assert.equal(op?.exact, command, "the operator can read every character they are asked to approve");
  const prior = process.env.TEND_PUBLIC;
  process.env.TEND_PUBLIC = "1";
  try {
    const seen = JSON.stringify(await read(db, await asVisitor(db)));
    assert.equal(seen.includes("git push --force"), false, "a visitor never receives the command");
  } finally {
    if (prior === undefined) delete process.env.TEND_PUBLIC; else process.env.TEND_PUBLIC = prior;
  }
});
