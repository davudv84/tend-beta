// Regression tests for the security-hardening pass: the client address used for rate limits, key revocation, and the
// guarantee that approvals (and nothing else) decide what the gateway runs. Each test fails on the code it replaced.
import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryDb } from "./db.ts";
import { clientIp, HttpError, limit } from "./http.ts";

const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void> | void) => {
  const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  const set = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  for (const [k, v] of Object.entries(env)) set(k, v);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) set(k, v);
  }
};
const from = (headers: Record<string, string>) => new Request("http://tend.test/", { headers });
const NONE = { TEND_TRUSTED_PROXY: undefined, VERCEL: undefined };

test("by default a forwarded address is client input and never picks the rate-limit bucket", async () => {
  await withEnv(NONE, async () => {
    for (const xff of ["1.2.3.4", "9.9.9.9", "5.5.5.5, 6.6.6.6", "not an address", "a".repeat(5000)]) assert.equal(clientIp(from({ "x-forwarded-for": xff })), "unknown");
    assert.equal(clientIp(from({ "x-real-ip": "7.7.7.7" })), "unknown");
    assert.equal(clientIp(from({})), "unknown");
  });
});

test("rotating X-Forwarded-For no longer escapes the sign-in limit, and cannot lock another address out", async () => {
  await awayFromMinuteBoundary();
  await withEnv(NONE, async () => {
    const db = await memoryDb();
    try {
      // The reproduction from the audit (F-03): thirty attempts, each claiming a different address.
      let refused = 0;
      for (let i = 0; i < 30; i++)
        await limit(db, `signin:${clientIp(from({ "x-forwarded-for": `10.0.0.${i}` }))}`, 10).catch((e) => { if (e instanceof HttpError && e.status === 429) refused++; });
      assert.equal(refused, 20, "attempts 11 to 30 are limited whatever address they claim");
    } finally {
      await db.close();
    }
  });
  await withEnv({ TEND_TRUSTED_PROXY: "1", VERCEL: undefined }, async () => {
    const db = await memoryDb();
    try {
      // Behind one trusted proxy the real address is the one the proxy appended; what the client put before it is ignored.
      const attacker = (spoof: string) => from({ "x-forwarded-for": `${spoof}, 203.0.113.9` });
      for (let i = 0; i < 12; i++) await limit(db, `signin:${clientIp(attacker(`10.0.0.${i}`))}`, 10).catch(() => {});
      await assert.rejects(() => limit(db, `signin:${clientIp(attacker("10.9.9.9"))}`, 10), (e) => e instanceof HttpError && e.status === 429);
      // The operator, from another address, is not affected by someone else claiming to be them.
      await limit(db, `signin:${clientIp(from({ "x-forwarded-for": "198.51.100.7" }))}`, 10);
      await limit(db, `signin:${clientIp(from({ "x-forwarded-for": "10.0.0.1, 198.51.100.7" }))}`, 10);
    } finally {
      await db.close();
    }
  });
});

test("a configured number of trusted proxies reads the address from the right, and fewer entries than that are not trusted", async () => {
  await withEnv({ TEND_TRUSTED_PROXY: "1", VERCEL: undefined }, () => {
    assert.equal(clientIp(from({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.9" })), "203.0.113.9");
    assert.equal(clientIp(from({})), "unknown", "no header from the proxy: no address");
    assert.equal(clientIp(from({ "x-forwarded-for": "evil" })), "unknown");
  });
  await withEnv({ TEND_TRUSTED_PROXY: "2", VERCEL: undefined }, () => {
    assert.equal(clientIp(from({ "x-forwarded-for": "1.1.1.1, 203.0.113.9, 10.0.0.2" })), "203.0.113.9");
    assert.equal(clientIp(from({ "x-forwarded-for": "10.0.0.2" })), "unknown", "one entry cannot hold two proxies' worth of trust");
  });
  for (const bad of ["0", "-1", "abc", "1.5", "100"]) await withEnv({ TEND_TRUSTED_PROXY: bad, VERCEL: undefined }, () => assert.equal(clientIp(from({ "x-forwarded-for": "203.0.113.9" })), "unknown", bad));
});

test("on Vercel the platform's address is used; TEND_TRUSTED_PROXY=0 turns that off", async () => {
  await withEnv({ VERCEL: "1", TEND_TRUSTED_PROXY: undefined }, () => {
    assert.equal(clientIp(from({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6" })), "203.0.113.9");
    assert.equal(clientIp(from({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })), "203.0.113.9", "the entry nearest the platform, not the first");
  });
  await withEnv({ VERCEL: "1", TEND_TRUSTED_PROXY: "0" }, () => assert.equal(clientIp(from({ "x-real-ip": "203.0.113.9" })), "unknown"));
});

test("addresses are validated and grouped: junk never becomes a key, one IPv6 /64 is one caller, mapped IPv4 stays itself", async () => {
  await withEnv({ TEND_TRUSTED_PROXY: "1", VERCEL: undefined }, () => {
    const ip = (v: string) => clientIp(from({ "x-forwarded-for": v }));
    assert.equal(ip("203.0.113.9:5555"), "203.0.113.9");
    assert.equal(ip("2001:db8:1:2:aaaa::1"), ip("2001:db8:1:2:bbbb:cccc::2"), "same /64");
    assert.notEqual(ip("2001:db8:1:2::1"), ip("2001:db8:1:3::1"), "different /64");
    assert.equal(ip("::ffff:203.0.113.9"), "203.0.113.9");
    assert.notEqual(ip("::ffff:203.0.113.9"), ip("::ffff:203.0.113.10"));
    for (const junk of ["", " ", "999.1.1.1", "1.2.3", "'; DROP TABLE rate_limits;--"]) assert.equal(ip(junk), "unknown", JSON.stringify(junk));
  });
});

// ---- key revocation -----------------------------------------------------------------------------------------------

import { authAgent } from "./agent-auth.ts";
import { claimToken } from "./authz.ts";
import { executeTool, fakePayments, requestExecution } from "./gateway.ts";
import { control, decide, getAgent, registerAgent, revokeKey, rotateKey, setPolicy } from "./repo.ts";
import { snapshot } from "./sync.ts";
import { viewerOf } from "./session.ts";
import { awayFromMinuteBoundary, signedIn } from "./test-support.ts";

process.env.TEND_GATEWAY_PAYMENTS_KEY = `fake_security_key_${"x".repeat(16)}`;
process.env.TEND_ADMIN_TOKEN = "test-admin-token-0123456789abcdef";
process.env.TEND_DEMO = "0";
const SID = "0123456789abcdef";
const bearer = (key: string) => new Request("http://tend.test/", { headers: { authorization: `Bearer ${key}` } });
const refused = async (p: Promise<unknown>, status: number, code?: string) =>
  assert.rejects(p, (e) => e instanceof HttpError && e.status === status && (!code || e.code === code));
let inv = 5000;
const pay = () => ({ invoice: `INV-${++inv}`, amountCents: 1234, currency: "EUR", payee: "PAYEE-1" });
const ledger = (id: string) => fakePayments().get(id)?.calls ?? 0;

async function fixture() {
  const db = await memoryDb();
  const { agent, apiKey } = await registerAgent(db, { name: "Payer", model: "m", provider: "Custom" }, SID);
  await setPolicy(db, agent.id, [{ tool: "pay_invoice", action: "execute", effect: "approve" }], "enforce", SID);
  return { db, agent, apiKey, live: async () => (await getAgent(db, agent.id))! };
}
const authz = (db: Awaited<ReturnType<typeof memoryDb>>, id: string) => db.get<{ status: string; token_hash: string | null }>("SELECT status, token_hash FROM authorizations WHERE id = ?", id);

test("a revoked key stops authenticating at once, and nothing replaces it", async () => {
  const { db, agent, apiKey } = await fixture();
  try {
    assert.equal((await authAgent(db, bearer(apiKey))).id, agent.id, "the key worked before");
    assert.deepEqual(await revokeKey(db, agent.id, SID), { revoked: true, cancelled: 0 });
    await refused(authAgent(db, bearer(apiKey)), 401, "invalid_key");
    const row = await db.get<{ key_hash: string | null; key_prefix: string | null }>("SELECT key_hash, key_prefix FROM agents WHERE id = ?", agent.id);
    assert.deepEqual(row, { key_hash: null, key_prefix: null }, "no hash is left to match, and no prefix is shown");
    // A guess at a key that does not exist is refused in the same way, and an empty hash matches nothing.
    await refused(authAgent(db, bearer(`tend_sk_${"a".repeat(32)}`)), 401, "invalid_key");
  } finally {
    await db.close();
  }
});

test("revoking cancels what the old key had waiting, so a new key cannot pick it up; spent history stays", async () => {
  const { db, agent, live } = await fixture();
  try {
    const a = await live();
    const ask = async (params = pay()) => ({ params, view: (await requestExecution(db, a, { tool: "pay_invoice", params }, null)).view });
    const approve = async (id: string) => {
      await decide(db, id, "approved");
      return ((await claimToken(db, a, id)).view as unknown as { token: string }).token;
    };
    const waiting = await ask();
    const unused = await ask();
    const unusedToken = await approve(unused.view.id);
    const spent = await ask();
    await executeTool(db, a, { authorizationId: spent.view.id, token: await approve(spent.view.id), tool: "pay_invoice", params: spent.params });
    assert.equal(ledger(spent.view.id), 1, "the payment that was approved and used ran once, before the revocation");

    assert.deepEqual(await revokeKey(db, agent.id, SID), { revoked: true, cancelled: 2 }, "the unanswered request and the unused approval, not the spent one");
    assert.deepEqual(await authz(db, waiting.view.id), { status: "cancelled", token_hash: null });
    assert.deepEqual(await authz(db, unused.view.id), { status: "cancelled", token_hash: null }, "its token no longer exists");
    assert.equal((await authz(db, spent.view.id))!.status, "consumed", "history is not rewritten");

    // Giving the agent access again must not resurrect either of them.
    const a2 = await authAgent(db, bearer((await rotateKey(db, agent.id, SID)).apiKey));
    await refused(claimToken(db, a2, unused.view.id), 403, "not_approved");
    await refused(executeTool(db, a2, { authorizationId: unused.view.id, token: unusedToken, tool: "pay_invoice", params: unused.params }), 403, "not_approved");
    await refused(decide(db, waiting.view.id, "approved"), 409);
    assert.equal(ledger(waiting.view.id) + ledger(unused.view.id), 0, "nothing the old key had waiting ever ran");
  } finally {
    await db.close();
  }
});

test("revoking is recorded once with who did it, repeating it records nothing, and demo or unknown agents are refused", async () => {
  const { db, agent } = await fixture();
  try {
    await revokeKey(db, agent.id, SID);
    assert.deepEqual(await revokeKey(db, agent.id, SID), { revoked: false, cancelled: 0 });
    const ev = await db.all<{ data: string }>("SELECT data FROM events WHERE type = 'key.revoked'");
    assert.equal(ev.length, 1, "one event, not two");
    assert.equal(JSON.parse(ev[0].data).by, SID);
    await refused(revokeKey(db, "no-such-agent", SID), 404);
    await db.run("UPDATE agents SET origin = 'demo' WHERE id = ?", agent.id);
    await refused(revokeKey(db, agent.id, SID), 409, "not_connected");
  } finally {
    await db.close();
  }
});

test("rotating a key also ends what the old key had waiting", async () => {
  const { db, agent, live } = await fixture();
  try {
    const waiting = (await requestExecution(db, await live(), { tool: "pay_invoice", params: pay() }, null)).view;
    await rotateKey(db, agent.id, SID);
    assert.equal((await authz(db, waiting.id))!.status, "cancelled");
  } finally {
    await db.close();
  }
});

test("a revoked agent shows no key to operators, and visitors are never told a key existed", async () => {
  process.env.TEND_PUBLIC = "1";
  const { db, agent } = await fixture();
  try {
    await db.run("UPDATE agents SET public = 1 WHERE id = ?", agent.id);
    const operator = (await signedIn(db)).request();
    assert.ok((await snapshot(db, await viewerOf(db, operator))).keys?.[agent.id], "a key prefix is listed while a key exists");
    await revokeKey(db, agent.id, SID);
    const after = await snapshot(db, await viewerOf(db, operator));
    assert.equal(after.keys?.[agent.id], undefined);
    const visitor = await snapshot(db, await viewerOf(db, new Request("http://tend.test/")));
    assert.equal("keys" in visitor, false);
    assert.ok(visitor.projection.log.some((l) => l.type === "key_revoked"), "that a key was revoked is public activity");
    assert.equal(visitor.projection.log.find((l) => l.type === "key_revoked") && JSON.stringify(visitor.projection).includes(SID), false, "the session that did it is not");
  } finally {
    await db.close();
    delete process.env.TEND_PUBLIC;
  }
});

// ---- approvals decide what runs -----------------------------------------------------------------------------------

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DB, Q } from "./db.ts";

/** A throwaway notes folder: the real tool writes real files here, so "did it run" is a fact about the disk. */
async function withNotes(fn: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(path.join(tmpdir(), "tend-sec-notes-"));
  chmodSync(dir, 0o700);
  const before = process.env.TEND_GATEWAY_NOTES_DIR;
  process.env.TEND_GATEWAY_NOTES_DIR = dir;
  try {
    await fn(dir);
  } finally {
    if (before === undefined) delete process.env.TEND_GATEWAY_NOTES_DIR;
    else process.env.TEND_GATEWAY_NOTES_DIR = before;
    rmSync(dir, { recursive: true, force: true });
  }
}
const noteFixture = async (effect = "approve") => {
  const db = await memoryDb();
  const { agent } = await registerAgent(db, { name: "Writer", model: "m", provider: "Custom" }, SID);
  await setPolicy(db, agent.id, [{ tool: "write_note", action: "create", effect }], "enforce", SID);
  return { db, agent: (await getAgent(db, agent.id))! };
};
const FAKE_TOKEN = `tend_az_${"A".repeat(43)}`;

test("a request that needs approval runs only after a person approves it, and never from a rejection, a forged token or another request's approval", () =>
  withNotes(async (dir) => {
    const { db, agent } = await noteFixture();
    try {
      const params = (name: string) => ({ name, text: `text of ${name}` });
      const ask = async (name: string) => (await requestExecution(db, agent, { tool: "write_note", params: params(name) }, null)).view;
      const run = (id: string, token: string, name: string) => executeTool(db, agent, { authorizationId: id, token, tool: "write_note", params: params(name) });

      const pending = await ask("pending");
      assert.equal(pending.status, "pending");
      assert.equal("token" in ((await claimToken(db, agent, pending.id)).view as object), false, "no token exists for a request nobody answered");
      await refused(run(pending.id, FAKE_TOKEN, "pending"), 403, "not_approved");

      const rejected = await ask("rejected");
      await decide(db, rejected.id, "rejected");
      await refused(claimToken(db, agent, rejected.id), 403, "not_approved");
      await refused(run(rejected.id, FAKE_TOKEN, "rejected"), 403, "not_approved");

      // Approving one request says nothing about another that asks for the same thing.
      const a = await ask("same"), b = await ask("same");
      assert.notEqual(a.id, b.id);
      await decide(db, a.id, "approved");
      const tokenA = ((await claimToken(db, agent, a.id)).view as unknown as { token: string }).token;
      await refused(run(b.id, tokenA, "same"), 403, "not_approved");
      assert.equal(existsSync(path.join(dir, "same.txt")), false, "B was never approved, so nothing was written");

      assert.deepEqual(await run(a.id, tokenA, "same").then((r) => r.result), { file: "same.txt", bytes: "text of same".length + 1 });
      assert.equal(readFileSync(path.join(dir, "same.txt"), "utf8"), "text of same\n");
      await refused(run(a.id, tokenA, "same"), 409, "already_consumed");

      assert.deepEqual([existsSync(path.join(dir, "pending.txt")), existsSync(path.join(dir, "rejected.txt"))], [false, false]);
    } finally {
      await db.close();
    }
  }));

test("a policy that allows an action needs no person, but a deny rule, a missing rule or a paused agent never runs it", () =>
  withNotes(async (dir) => {
    const { db, agent } = await noteFixture("allow");
    try {
      const go = async (name: string) => {
        const { view } = await requestExecution(db, agent, { tool: "write_note", params: { name, text: "x" } }, null);
        if (view.status !== "approved") return view;
        const { token } = (await claimToken(db, agent, view.id)).view as unknown as { token: string };
        await executeTool(db, agent, { authorizationId: view.id, token, tool: "write_note", params: { name, text: "x" } });
        return view;
      };
      assert.equal((await go("allowed")).status, "approved");
      assert.equal(existsSync(path.join(dir, "allowed.txt")), true);

      await setPolicy(db, agent.id, [{ tool: "write_note", action: "create", effect: "deny" }], "enforce", SID);
      assert.equal((await go("denied")).status, "denied");
      await setPolicy(db, agent.id, [], "enforce", SID);
      assert.equal((await go("unlisted")).status, "denied");
      await setPolicy(db, agent.id, [{ tool: "write_note", action: "create", effect: "allow" }], "enforce", SID);
      await control(db, agent.id, "pause", undefined, SID);
      assert.equal((await go("paused")).status, "denied");
      assert.deepEqual(["denied", "unlisted", "paused"].map((n) => existsSync(path.join(dir, `${n}.txt`))), [false, false, false]);
    } finally {
      await db.close();
    }
  }));

// ---- failing closed -----------------------------------------------------------------------------------------------

/** A database that fails every statement matching `broken`, inside transactions too, as a real outage or constraint failure would. */
function failing(db: DB, broken: () => RegExp | undefined): DB {
  const wrap = (q: Q): Q => {
    const guard = (sql: string) => {
      const re = broken();
      if (re?.test(sql)) throw new Error("simulated database failure");
    };
    return {
      ...q,
      all: (sql, ...p) => (guard(sql), q.all(sql, ...p)),
      get: (sql, ...p) => (guard(sql), q.get(sql, ...p)),
      run: (sql, ...p) => (guard(sql), q.run(sql, ...p)),
    } as Q;
  };
  return { ...wrap(db), kind: db.kind, tx: (fn) => db.tx((q) => fn(wrap(q))), close: () => db.close() } as DB;
}

test("if the database fails while an approval is being spent, nothing runs and the approval is still there to use once the database is back", () =>
  withNotes(async (dir) => {
    const { db, agent } = await noteFixture();
    let broken: RegExp | undefined;
    const flaky = failing(db, () => broken);
    try {
      const params = { name: "outage", text: "written once" };
      const { view } = await requestExecution(flaky, agent, { tool: "write_note", params }, null);
      await decide(flaky, view.id, "approved");
      const { token } = (await claimToken(flaky, agent, view.id)).view as unknown as { token: string };
      const body = { authorizationId: view.id, token, tool: "write_note", params };

      broken = /status = 'consumed'/;
      await assert.rejects(() => executeTool(flaky, agent, body), (e) => !(e instanceof HttpError) && /simulated/.test(String((e as Error).message)), "a failure, not a success");
      assert.equal(existsSync(path.join(dir, "outage.txt")), false, "the tool did not run");
      assert.equal((await authz(db, view.id))!.status, "approved", "and the approval was not spent");

      broken = undefined;
      assert.equal((await executeTool(flaky, agent, body)).executed, true, "it runs when the database is back");
      await refused(executeTool(flaky, agent, body), 409, "already_consumed");
      assert.equal(readFileSync(path.join(dir, "outage.txt"), "utf8"), "written once\n");
    } finally {
      await db.close();
    }
  }));

test("if the rate-limit store fails, an agent is not let through", async () => {
  const { db, apiKey } = await fixture();
  let broken: RegExp | undefined;
  const flaky = failing(db, () => broken);
  try {
    assert.ok(await authAgent(flaky, bearer(apiKey)));
    broken = /rate_limits/;
    await assert.rejects(() => authAgent(flaky, bearer(apiKey)), /simulated/);
    await assert.rejects(() => limit(flaky, "signin:unknown", 10), /simulated/, "and the sign-in limit refuses too");
  } finally {
    await db.close();
  }
});

test("without a usable admin token nobody is an operator, however the session was made", async () => {
  const db = await memoryDb();
  try {
    await withEnv({ TEND_ADMIN_TOKEN: "test-admin-token-0123456789abcdef" }, async () => {
      const { checkAdminToken } = await import("./auth.ts");
      const { requireOperator } = await import("./http.ts");
      const { isOperator } = await import("./session.ts");
      const me = await signedIn(db);
      assert.equal(await isOperator(db, me.request()), true);
      for (const token of [undefined, "", "short", "x".repeat(23)]) {
        await withEnv({ TEND_ADMIN_TOKEN: token }, async () => {
          assert.equal(await isOperator(db, me.request()), false, `token ${JSON.stringify(token)}`);
          await assert.rejects(() => requireOperator(me.request(), db), (e) => e instanceof HttpError && e.status === 403);
          assert.equal(checkAdminToken(""), false, "an empty guess does not match an unset token");
          assert.equal(checkAdminToken(token ?? ""), false, "nor does the unusable value itself");
        });
      }
      // Rotating the token signs every existing session out.
      await withEnv({ TEND_ADMIN_TOKEN: "another-admin-token-0123456789abcdef" }, async () => assert.equal(await isOperator(db, me.request()), false));
    });
  } finally {
    await db.close();
  }
});
