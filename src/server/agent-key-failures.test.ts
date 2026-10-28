// R-07: rejected agent keys are limited per caller address and recorded (without the key) in the append-only authentication log.
import assert from "node:assert/strict";
import { test } from "node:test";
import { authAgent, KEY_FAILURES_PER_MINUTE } from "./agent-auth.ts";
import { memoryDb } from "./db.ts";
import { HttpError } from "./http.ts";
import { registerAgent } from "./repo.ts";
import { audit } from "./session.ts";
import { awayFromMinuteBoundary } from "./test-support.ts";

const WRONG = `tend_sk_${"w".repeat(32)}`;
const req = (key: string | null, ip?: string) => new Request("http://tend.test/api/v1/agent/inbox", { headers: { ...(key && { authorization: `Bearer ${key}` }), ...(ip && { "x-forwarded-for": ip }) } });
const status = (p: Promise<unknown>) => p.then(() => 200, (e: HttpError) => e.status);
const events = (db: Awaited<ReturnType<typeof memoryDb>>) => db.all<{ type: string; client: string | null; reason: string | null }>("SELECT type, client, reason FROM auth_events ORDER BY seq");

async function withProxy(fn: () => Promise<void>) {
  const before = process.env.TEND_TRUSTED_PROXY;
  process.env.TEND_TRUSTED_PROXY = "1";
  try {
    await fn();
  } finally {
    if (before === undefined) delete process.env.TEND_TRUSTED_PROXY; else process.env.TEND_TRUSTED_PROXY = before;
  }
}

test("a wrong key is refused with 401 and logged with the caller and the reason, never the key", async () => {
  await awayFromMinuteBoundary();
  const db = await memoryDb();
  try {
    await withProxy(async () => {
      assert.equal(await status(authAgent(db, req(WRONG, "203.0.113.7"))), 401);
      assert.equal(await status(authAgent(db, req(null, "203.0.113.7"))), 401);
    });
    const ev = await events(db);
    assert.deepEqual(ev.map((e) => [e.type, e.client, e.reason]), [["agentkey.rejected", "203.0.113.7", "invalid_key"]], "only a presented key is logged; a bare request is just counted");
    assert.equal(JSON.stringify(ev).includes(WRONG), false);
  } finally {
    await db.close();
  }
});

test("past the per-minute budget a caller gets 429 for further wrong keys; other addresses and valid keys are untouched", async () => {
  await awayFromMinuteBoundary();
  const db = await memoryDb();
  try {
    const { agent, apiKey } = await registerAgent(db, { name: "Real", model: "m", provider: "OpenAI" });
    await withProxy(async () => {
      const results: number[] = [];
      for (let i = 0; i < KEY_FAILURES_PER_MINUTE + 5; i++) results.push(await status(authAgent(db, req(WRONG, "198.51.100.9"))));
      assert.deepEqual([...new Set(results.slice(0, KEY_FAILURES_PER_MINUTE))], [401]);
      assert.deepEqual([...new Set(results.slice(KEY_FAILURES_PER_MINUTE))], [429], "then the same address is limited");
      assert.equal(await status(authAgent(db, req(WRONG, "198.51.100.10"))), 401, "another address is not");
      // The attacker's budget is spent, but the real agent (same address even) is not locked out: valid keys never use this budget.
      assert.equal((await authAgent(db, req(apiKey, "198.51.100.9"))).id, agent.id);
    });
  } finally {
    await db.close();
  }
});

test("without a trusted address nobody is refused (no one to hold responsible), but the attempts are still logged", async () => {
  await awayFromMinuteBoundary();
  const db = await memoryDb();
  try {
    const out: number[] = [];
    for (let i = 0; i < KEY_FAILURES_PER_MINUTE + 5; i++) out.push(await status(authAgent(db, req(WRONG))));
    assert.deepEqual([...new Set(out)], [401]);
    assert.ok((await events(db)).length > 0 && (await events(db)).every((e) => e.type === "agentkey.rejected" && e.client === "unknown"));
  } finally {
    await db.close();
  }
});

test("the log is bounded, says so once, and a key flood cannot crowd out sign-in failures (separate budgets)", async () => {
  await awayFromMinuteBoundary(15_000);
  const db = await memoryDb();
  try {
    for (let i = 0; i < 90; i++) await status(authAgent(db, req(WRONG)));
    await audit(db, "signin.failed", { client: "unknown", reason: "invalid_token" });
    const ev = await events(db);
    assert.equal(ev.filter((e) => e.type === "agentkey.rejected").length, 61 - 1, "capped at the budget");
    assert.equal(ev.filter((e) => e.type === "log.suppressed").length, 1, "one row says records were dropped");
    assert.equal(ev.filter((e) => e.type === "signin.failed").length, 1, "the sign-in failure was still recorded");
  } finally {
    await db.close();
  }
});
