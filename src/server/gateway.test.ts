import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { TTL, claimToken, cancelAuthorization } from "./authz.ts";
import { memoryDb } from "./db.ts";
import { executeTool, fakePayments, MAX_CENTS, requestExecution } from "./gateway.ts";
import { HttpError } from "./http.ts";
import { control, decide, registerAgent } from "./repo.ts";

const KEY = `fake_gateway_key_${"x".repeat(16)}`;
process.env.TEND_GATEWAY_PAYMENTS_KEY = KEY;

const POLICY = [{ tool: "pay_invoice", action: "execute", effect: "approve" }];
let n = 0;
/** A fresh invoice per test, so the shared fake ledger never mixes tests. */
const pay = (over: object = {}) => ({ invoice: `INV-${++n}`, amountCents: 1234, currency: "EUR", payee: "PAYEE-1", ...over });

async function setup(policy: unknown = POLICY) {
  const db = await memoryDb();
  const mk = async (name: string) => {
    const { agent } = await registerAgent(db, { name, model: "m", provider: "Anthropic" });
    await db.run("UPDATE agents SET policy = ? WHERE id = ?", JSON.stringify(policy), agent.id);
    return agent;
  };
  return { db, agent: await mk("Payer"), other: await mk("Other") };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const fails = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, code: e.code, extra: e.extra, message: e.message };
    throw e;
  }
  return assert.fail("expected the call to be refused");
};
const calls = (id: string) => fakePayments().get(id)?.calls ?? 0;
const gwEvents = async (db: Ctx["db"]) =>
  (await db.all<{ data: string }>("SELECT data FROM events WHERE type = 'tool.called' ORDER BY seq")).map((r) => JSON.parse(r.data)).filter((d) => d.via === "gateway");

/** Requested through the gateway, approved by a person, token claimed. */
async function approved(c: Ctx, params = pay(), now?: number) {
  const { view } = await requestExecution(c.db, c.agent, { tool: "pay_invoice", params }, null, now);
  assert.equal(view.status, "pending");
  await decide(c.db, view.id, "approved");
  const { token } = (await claimToken(c.db, c.agent, view.id, now)).view as unknown as { token: string };
  return { id: view.id, token, params };
}
const exec = (c: Ctx, a: { id: string; token: string; params: object }, over: object = {}, now?: number) =>
  executeTool(c.db, c.agent, { authorizationId: a.id, token: a.token, tool: "pay_invoice", params: a.params, ...over }, now);

test("an agent with no policy is denied before anything runs", async () => {
  const c = await setup([]);
  const { view } = await requestExecution(c.db, c.agent, { tool: "pay_invoice", params: pay() }, null);
  assert.equal(view.status, "denied");
  assert.equal(view.reason, "no_policy");
  const e = await fails(() => executeTool(c.db, c.agent, { authorizationId: view.id, token: `tend_az_${"a".repeat(43)}`, tool: "pay_invoice", params: pay() }));
  assert.equal(e.status, 403);
  assert.equal(calls(view.id), 0);
});

test("the approval shows exactly what will run, derived by the gateway from the params", async () => {
  const c = await setup();
  const { view } = await requestExecution(c.db, c.agent, { tool: "pay_invoice", params: pay({ amountCents: 5, currency: "USD", payee: "PAYEE-2" }) }, null);
  assert.equal(view.tool, "pay_invoice");
  assert.equal(view.action, "execute");
  assert.match(view.resource!, /^INV-\d+$/);
  assert.equal(view.detail, "USD 0.05 to Example Office Supplies Ltd (PAYEE-2)");
  // Distinct amounts always give distinct approvals (no rounding collapses two payments into one).
  const seen = new Set<string>();
  for (const amountCents of [1, 10, 100, 101, 1010, 99_999, MAX_CENTS]) seen.add((await requestExecution(c.db, c.agent, { tool: "pay_invoice", params: pay({ amountCents }) }, null)).view.detail!);
  assert.equal(seen.size, 7);
});

test("a human-approved request executes exactly once and the result carries no credential", async () => {
  const c = await setup();
  const a = await approved(c);
  const out = await exec(c, a);
  assert.equal(out.executed, true);
  assert.deepEqual(Object.keys(out.result).sort(), ["paymentId", "status"]);
  assert.equal(out.result.status, "settled");
  assert.equal(calls(a.id), 1);
  // The fake upstream leaked the key in its answer; the gateway did not pass it on.
  assert.equal(JSON.stringify(out).includes(KEY), false);

  const again = await fails(() => exec(c, a));
  assert.equal(again.status, 409);
  assert.equal(again.code, "already_consumed");
  assert.equal(calls(a.id), 1, "a replay never reaches the tool");

  const ev = await gwEvents(c.db);
  assert.deepEqual(ev.map((d) => d.outcome), ["success", "denied"]);
  assert.equal(ev[1].error, "already_consumed");
  const all = (await c.db.all<{ data: string }>("SELECT data FROM events")).map((r) => r.data).join("\n");
  assert.equal(all.includes(KEY), false, "the credential never enters the event log");
  assert.equal(all.includes(a.token), false, "nor the token");
});

test("concurrent executions with one authorization: exactly one runs", async () => {
  const c = await setup();
  const a = await approved(c);
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => exec(c, a)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(calls(a.id), 1);
});

test("changed parameters are refused before execution", async () => {
  const c = await setup();
  const a = await approved(c);
  for (const change of [{ amountCents: 99_999 }, { payee: "PAYEE-2" }, { currency: "USD" }, { invoice: "INV-999999" }]) {
    const e = await fails(() => exec(c, a, { params: { ...a.params, ...change } }));
    assert.equal(e.status, 403, JSON.stringify(change));
  }
  assert.equal(calls(a.id), 0);
  // Three mismatches revoked the approval; even the right params no longer run.
  assert.equal((await fails(() => exec(c, a))).status, 403);
  assert.equal(calls(a.id), 0);
});

test("an expired token is refused", async () => {
  const c = await setup();
  const t0 = Date.now();
  const a = await approved(c, pay(), t0);
  const e = await fails(() => exec(c, a, {}, t0 + TTL.token + 1));
  assert.equal(e.code, "token_expired");
  assert.equal(calls(a.id), 0);
});

test("wrong token, another agent, cancelled or revoked approvals never run", async () => {
  const c = await setup();
  const a = await approved(c);
  assert.equal((await fails(() => exec(c, a, { token: `tend_az_${"b".repeat(43)}` }))).code, "invalid_token");
  assert.equal((await fails(() => executeTool(c.db, c.other, { authorizationId: a.id, token: a.token, tool: "pay_invoice", params: a.params }))).status, 404);

  const b = await approved(c);
  await cancelAuthorization(c.db, c.agent, b.id);
  assert.equal((await fails(() => exec(c, b))).code, "not_approved");

  const d = await approved(c);
  await control(c.db, c.agent.id, "pause");
  assert.equal((await fails(() => exec(c, d))).code, "not_permitted");
  assert.equal(calls(a.id) + calls(b.id) + calls(d.id), 0);
});

test("strict schemas: no unknown tools, fields, URLs, commands or coerced values", async () => {
  const c = await setup();
  const req = (body: object) => fails(() => requestExecution(c.db, c.agent, body, null));
  assert.equal((await req({ tool: "shell", params: { command: "ls" } })).code, "unknown_tool");
  assert.equal((await req({ tool: "__proto__", params: {} })).code, "unknown_tool");
  assert.equal((await req({ tool: "pay_invoice", params: pay(), url: "https://evil.example" })).code, "invalid_request");
  for (const params of [
    { ...pay(), url: "https://evil.example" }, { ...pay(), command: "rm -rf /" }, pay({ payee: "__proto__" }), pay({ payee: "DE89370400440532013000" }),
    pay({ amountCents: "1234" }), pay({ amountCents: 12.5 }), pay({ amountCents: -1 }), pay({ amountCents: MAX_CENTS + 1 }), pay({ invoice: "INV-1; DROP TABLE" }),
    pay({ currency: "eur" }), null, [], "INV-1",
  ]) assert.equal((await req({ tool: "pay_invoice", params })).code, "invalid_params", JSON.stringify(params));
  const a = await approved(c);
  assert.equal((await fails(() => exec(c, a, { extra: 1 }))).code, "invalid_request");
  assert.equal((await fails(() => exec(c, a, { params: { ...a.params, url: "x" } }))).code, "invalid_params");
  assert.equal(calls(a.id), 0);
  assert.equal((await exec(c, a)).executed, true, "refused malformed attempts did not spend the approval");
});

test("an unconfigured credential fails closed without spending the approval", async () => {
  const c = await setup();
  const a = await approved(c);
  process.env.TEND_GATEWAY_PAYMENTS_KEY = "";
  try {
    assert.equal((await fails(() => exec(c, a))).code, "tool_unavailable");
  } finally {
    process.env.TEND_GATEWAY_PAYMENTS_KEY = KEY;
  }
  assert.equal((await exec(c, a)).executed, true);
});

test("a transient failure is retried with the same idempotency key and pays once", async () => {
  const c = await setup();
  const a = await approved(c, pay({ invoice: "INV-503" }));
  const out = await exec(c, a);
  assert.equal(out.executed, true);
  assert.equal(calls(a.id), 2);
});

test("a tool that never answers times out, is not retried, and reports no upstream detail", async () => {
  const c = await setup();
  const a = await approved(c, pay({ invoice: "INV-504" }));
  const t = Date.now();
  const e = await fails(() => exec(c, a));
  assert.ok(Date.now() - t < 5_000);
  assert.equal(e.status, 502);
  assert.equal(e.extra?.reason, "timeout");
  assert.equal(calls(a.id), 1);
  assert.equal(JSON.stringify(e).includes(KEY), false);
  const ev = (await gwEvents(c.db)).at(-1);
  assert.equal(ev.outcome, "failure");
  assert.equal(ev.error, "timeout");
  assert.equal((await fails(() => exec(c, a))).code, "already_consumed", "the spent authorization cannot be retried");
});

test("write_note: names cannot be paths, it writes only into the configured directory, and never overwrites", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tend-notes-test-"));
  const c = await setup([{ tool: "write_note", action: "create", effect: "approve" }]);
  const ask = (params: object) => requestExecution(c.db, c.agent, { tool: "write_note", params }, null);
  try {
    for (const name of ["../escape", "a/b", "/etc/passwd", "A", ".hidden", "x".repeat(33)])
      assert.equal((await fails(() => ask({ name, text: "hi" }))).code, "invalid_params", name);
    assert.equal((await fails(() => ask({ name: "n", text: "line\nbreak" }))).code, "invalid_params");

    const note = async (params: { name: string; text: string }) => {
      const { view } = await ask(params);
      assert.equal(view.detail, params.text, "the person approves the exact text");
      await decide(c.db, view.id, "approved");
      const { token } = (await claimToken(c.db, c.agent, view.id)).view as unknown as { token: string };
      return () => executeTool(c.db, c.agent, { authorizationId: view.id, token, tool: "write_note", params });
    };
    const first = await note({ name: "hello", text: "Hello" });
    assert.equal((await fails(first)).code, "tool_unavailable", "off unless configured, and the approval is not spent");
    process.env.TEND_GATEWAY_NOTES_DIR = dir;
    assert.deepEqual((await first()).result, { file: "hello.txt", bytes: 6 });
    assert.equal(readFileSync(path.join(dir, "hello.txt"), "utf8"), "Hello\n");
    assert.equal((await fails(await note({ name: "hello", text: "Overwrite" }))).code, "execution_failed");
    assert.equal(readFileSync(path.join(dir, "hello.txt"), "utf8"), "Hello\n");
    assert.deepEqual(readdirSync(dir), ["hello.txt"]);
  } finally {
    delete process.env.TEND_GATEWAY_NOTES_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("list_notes and read_note stay inside the configured directory; reject, mismatch and replay never touch files", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tend-notes-org-"));
  const policy = [
    { tool: "list_notes", action: "list", effect: "approve" },
    { tool: "read_note", action: "read", effect: "approve" },
    { tool: "write_note", action: "create", effect: "approve" },
  ];
  const c = await setup([]);
  await c.db.run("UPDATE agents SET policy = ? WHERE id = ?", JSON.stringify(policy), c.agent.id);
  process.env.TEND_GATEWAY_NOTES_DIR = dir;
  try {
    const seed = "FICTIONAL standup: Anna owns the Q4 plan.";
    writeFileSync(path.join(dir, "standup.txt"), `${seed}\n`);

    const waiting = await requestExecution(c.db, c.agent, { tool: "list_notes", params: {} }, null);
    assert.equal(waiting.view.status, "pending");
    assert.equal((await fails(() => executeTool(c.db, c.agent, { authorizationId: waiting.view.id, token: `tend_az_${"a".repeat(43)}`, tool: "list_notes", params: {} }))).status, 403);
    assert.deepEqual(readdirSync(dir), ["standup.txt"]);

    await decide(c.db, waiting.view.id, "rejected");
    assert.equal((await fails(() => executeTool(c.db, c.agent, { authorizationId: waiting.view.id, token: `tend_az_${"a".repeat(43)}`, tool: "list_notes", params: {} }))).status, 403);
    assert.deepEqual(readdirSync(dir), ["standup.txt"], "a rejected list does not run");

    const listed = await requestExecution(c.db, c.agent, { tool: "list_notes", params: {} }, null);
    await decide(c.db, listed.view.id, "approved");
    const listTok = (await claimToken(c.db, c.agent, listed.view.id)).view as unknown as { token: string };
    const listing = await executeTool(c.db, c.agent, { authorizationId: listed.view.id, token: listTok.token, tool: "list_notes", params: {} });
    assert.deepEqual(listing.result, { names: "standup", count: 1 });
    assert.equal((await fails(() => executeTool(c.db, c.agent, { authorizationId: listed.view.id, token: listTok.token, tool: "list_notes", params: {} }))).code, "already_consumed");

    const read = await requestExecution(c.db, c.agent, { tool: "read_note", params: { name: "standup" } }, null);
    await decide(c.db, read.view.id, "approved");
    const readTok = (await claimToken(c.db, c.agent, read.view.id)).view as unknown as { token: string };
    const mismatch = await fails(() => executeTool(c.db, c.agent, { authorizationId: read.view.id, token: readTok.token, tool: "read_note", params: { name: "other" } }));
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.code, "mismatch");
    const got = await executeTool(c.db, c.agent, { authorizationId: read.view.id, token: readTok.token, tool: "read_note", params: { name: "standup" } });
    assert.equal(got.result.file, "standup.txt");
    assert.equal(String(got.result.text).includes(seed), true);

    for (const name of ["../escape", "a/b", "/etc/passwd"])
      assert.equal((await fails(() => requestExecution(c.db, c.agent, { tool: "read_note", params: { name } }, null))).code, "invalid_params", name);
    assert.equal((await fails(() => requestExecution(c.db, c.agent, { tool: "list_notes", params: { path: dir } }, null))).code, "invalid_params");
  } finally {
    delete process.env.TEND_GATEWAY_NOTES_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});
