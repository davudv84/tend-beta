// The sandbox tools (read_test_file, write_test_file, delete_test_file) through the real gateway on an in-memory database
// and a real temporary directory. Provider-independent: OpenAI and Anthropic agents reach exactly these functions, so
// this is the one place the security matrix is proven; the provider tests (examples/real-agents) prove the adapters add no path around it.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { authAgent } from "./agent-auth.ts";
import { TTL, claimToken } from "./authz.ts";
import { memoryDb, type DB, type Q } from "./db.ts";
import { executeTool, requestExecution } from "./gateway.ts";
import { HttpError } from "./http.ts";
import { decide, registerAgent, revokeKey, setPolicy } from "./repo.ts";

/** The suggested policy from scripts/suggested-policy.mjs. */
const POLICY = [
  { tool: "read_test_file", action: "read", effect: "allow" },
  { tool: "write_test_file", action: "create", effect: "approve" },
  { tool: "delete_test_file", action: "delete", effect: "deny" },
];

async function setup(policy: unknown = POLICY) {
  const dir = mkdtempSync(path.join(tmpdir(), "tend-sandbox-test-"));
  const outside = mkdtempSync(path.join(tmpdir(), "tend-outside-test-"));
  writeFileSync(path.join(dir, "seed.txt"), "FICTIONAL seed\n");
  writeFileSync(path.join(outside, "secret.txt"), "OUTSIDE SECRET\n");
  process.env.TEND_GATEWAY_SANDBOX_DIR = dir;
  const db = await memoryDb();
  const mk = async (name: string) => {
    const { agent, apiKey } = await registerAgent(db, { name, model: "m", provider: "OpenAI" });
    await setPolicy(db, agent.id, policy, "enforce");
    return { agent, apiKey };
  };
  const a = await mk("Sandbox agent");
  const b = await mk("Other agent");
  const files = () => Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(path.join(dir, f), "utf8")]));
  const cleanup = async () => {
    delete process.env.TEND_GATEWAY_SANDBOX_DIR;
    await db.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  };
  return { db, dir, outside, agent: a.agent, key: a.apiKey, other: b.agent, files, cleanup };
}
type S = Awaited<ReturnType<typeof setup>>;

const refused = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
  return assert.fail("expected the call to be refused");
};
const ask = (s: S, tool: string, params: unknown, agent = s.agent) => requestExecution(s.db, agent, { tool, params }, null);
/** Requested, approved by a person, token claimed. */
async function approvedWrite(s: S, params = { path: "note.txt", text: "approved text" }, now?: number) {
  const { view } = await ask(s, "write_test_file", params);
  assert.equal(view.status, "pending");
  await decide(s.db, view.id, "approved");
  const { token } = (await claimToken(s.db, s.agent, view.id, now)).view as unknown as { token: string };
  return { id: view.id, token, params };
}
const run = (s: S, a: { id: string; token: string; params: object }, over: object = {}, now?: number, tool = "write_test_file") =>
  executeTool(s.db, s.agent, { authorizationId: a.id, token: a.token, tool, params: a.params, ...over }, now);
const outcomes = async (db: DB) =>
  (await db.all<{ data: string }>("SELECT data FROM events WHERE type = 'tool.called' ORDER BY seq")).map((r) => JSON.parse(r.data)).filter((d) => d.via === "gateway");
const fresh = async (s: S, tool: string, params: object, now = Date.now()) => {
  const { view } = await requestExecution(s.db, s.agent, { tool, params }, null, now);
  return view;
};

// 1. allowed ------------------------------------------------------------------------------------------------------

test("READ is allowed: no person is needed, the file's text comes back, and the gateway records one success", async () => {
  const s = await setup();
  try {
    const view = await fresh(s, "read_test_file", { path: "seed.txt" });
    assert.equal(view.status, "approved");
    const { token } = (await claimToken(s.db, s.agent, view.id)).view as unknown as { token: string };
    const out = await executeTool(s.db, s.agent, { authorizationId: view.id, token, tool: "read_test_file", params: { path: "seed.txt" } });
    assert.deepEqual(out.result, { file: "seed.txt", text: "FICTIONAL seed\n", bytes: 15 });
    const [o] = await outcomes(s.db);
    assert.deepEqual([o.tool, o.action, o.resource, o.outcome], ["read_test_file", "read", "seed.txt", "success"]);
  } finally {
    await s.cleanup();
  }
});

// 2. denied --------------------------------------------------------------------------------------------------------

test("DELETE is denied: the file stays, no approval can exist, and a forged token changes nothing", async () => {
  const s = await setup();
  try {
    const view = await fresh(s, "delete_test_file", { path: "seed.txt" });
    assert.deepEqual([view.status, view.reason], ["denied", "policy_denied"]);
    for (const token of [`tend_az_${"a".repeat(43)}`, "x"]) {
      const e = await refused(executeTool(s.db, s.agent, { authorizationId: view.id, token, tool: "delete_test_file", params: { path: "seed.txt" } }));
      assert.equal(e.status, 403);
    }
    // A person cannot approve a request that was denied.
    await refused(decide(s.db, view.id, "approved"));
    assert.ok(existsSync(path.join(s.dir, "seed.txt")), "the file is still there");
    assert.equal((await outcomes(s.db)).filter((o) => o.outcome === "success").length, 0);
  } finally {
    await s.cleanup();
  }
});

test("the delete tool really deletes: it is the deny rule, not an empty tool, that protects the file", async () => {
  const s = await setup([{ tool: "delete_test_file", action: "delete", effect: "approve" }]);
  try {
    const { view } = await ask(s, "delete_test_file", { path: "seed.txt" });
    await decide(s.db, view.id, "approved");
    const { token } = (await claimToken(s.db, s.agent, view.id)).view as unknown as { token: string };
    await executeTool(s.db, s.agent, { authorizationId: view.id, token, tool: "delete_test_file", params: { path: "seed.txt" } });
    assert.equal(existsSync(path.join(s.dir, "seed.txt")), false);
  } finally {
    await s.cleanup();
  }
});

test("a policy change after approval blocks the run: DELETE denied later never executes", async () => {
  const s = await setup([{ tool: "delete_test_file", action: "delete", effect: "approve" }]);
  try {
    const { view } = await ask(s, "delete_test_file", { path: "seed.txt" });
    await decide(s.db, view.id, "approved");
    const { token } = (await claimToken(s.db, s.agent, view.id)).view as unknown as { token: string };
    await setPolicy(s.db, s.agent.id, POLICY, "enforce");
    const e = await refused(executeTool(s.db, s.agent, { authorizationId: view.id, token, tool: "delete_test_file", params: { path: "seed.txt" } }));
    assert.equal(e.code, "not_permitted");
    assert.ok(existsSync(path.join(s.dir, "seed.txt")));
  } finally {
    await s.cleanup();
  }
});

// 3. approval granted / 4. rejected --------------------------------------------------------------------------------

test("WRITE waits for a person; once approved it writes exactly the approved bytes, once", async () => {
  const s = await setup();
  try {
    const before = s.files();
    const a = await approvedWrite(s);
    assert.deepEqual(s.files(), before, "nothing is written while it is pending or merely approved");
    const out = await run(s, a);
    assert.equal(out.executed, true);
    assert.equal(readFileSync(path.join(s.dir, "note.txt"), "utf8"), "approved text\n");
    assert.deepEqual(Object.keys(s.files()).sort(), ["note.txt", "seed.txt"]);
  } finally {
    await s.cleanup();
  }
});

test("a rejected WRITE never runs, and its id cannot be used", async () => {
  const s = await setup();
  try {
    const { view } = await ask(s, "write_test_file", { path: "no.txt", text: "x" });
    await decide(s.db, view.id, "rejected");
    const claim = await refused(claimToken(s.db, s.agent, view.id));
    assert.ok(claim.status >= 400);
    const e = await refused(executeTool(s.db, s.agent, { authorizationId: view.id, token: `tend_az_${"b".repeat(43)}`, tool: "write_test_file", params: { path: "no.txt", text: "x" } }));
    assert.equal(e.status, 403);
    assert.equal(existsSync(path.join(s.dir, "no.txt")), false);
  } finally {
    await s.cleanup();
  }
});

// 5. expiry --------------------------------------------------------------------------------------------------------

test("an approval that expired is refused and nothing is written", async () => {
  const s = await setup();
  try {
    const t0 = Date.now();
    const a = await approvedWrite(s, undefined, t0);
    const e = await refused(run(s, a, {}, t0 + TTL.approval + 1000));
    assert.equal(e.status, 403);
    assert.equal(existsSync(path.join(s.dir, "note.txt")), false);
    // A token that outlived its 60 seconds is refused even while the approval is still valid.
    const b = await approvedWrite(s, { path: "late.txt", text: "late" }, t0);
    assert.equal((await refused(run(s, b, {}, t0 + TTL.token + 1000))).code, "token_expired");
    assert.equal(existsSync(path.join(s.dir, "late.txt")), false);
  } finally {
    await s.cleanup();
  }
});

// 6. replay / 14. duplicate calls ----------------------------------------------------------------------------------

test("an approval is single use: a replay is refused with a replay alert and writes nothing", async () => {
  const s = await setup();
  try {
    const a = await approvedWrite(s);
    await run(s, a);
    writeFileSync(path.join(s.dir, "note.txt"), "changed by someone else\n");
    const e = await refused(run(s, a));
    assert.equal(e.code, "already_consumed");
    assert.equal(readFileSync(path.join(s.dir, "note.txt"), "utf8"), "changed by someone else\n", "the replay did not touch the file");
    const alerts = await s.db.all<{ data: string }>("SELECT data FROM events WHERE type = 'alert.raised'");
    assert.ok(alerts.some((r) => JSON.parse(r.data).kind === "authorization_replay"));
  } finally {
    await s.cleanup();
  }
});

test("a duplicated provider tool call is a second request: the first approval does not cover it", async () => {
  const s = await setup();
  try {
    const first = await approvedWrite(s, { path: "dup.txt", text: "same text" });
    const second = await ask(s, "write_test_file", { path: "dup.txt", text: "same text" });
    assert.equal(second.view.status, "pending", "identical content still needs its own decision");
    assert.notEqual(second.view.id, first.id);
    await run(s, first);
    // The first token cannot be pointed at the second request.
    const e = await refused(executeTool(s.db, s.agent, { authorizationId: second.view.id, token: first.token, tool: "write_test_file", params: first.params }));
    assert.equal(e.status, 403);
    assert.equal(readFileSync(path.join(s.dir, "dup.txt"), "utf8"), "same text\n");
  } finally {
    await s.cleanup();
  }
});

// 7. modified arguments --------------------------------------------------------------------------------------------

test("changing the file name or the text after approval is refused; three attempts revoke the approval", async () => {
  const s = await setup();
  try {
    const a = await approvedWrite(s);
    for (const change of [{ path: "other.txt" }, { text: "different text" }]) {
      const e = await refused(run(s, a, { params: { ...a.params, ...change } }));
      assert.equal(e.code, "mismatch", JSON.stringify(change));
    }
    assert.equal(Object.keys(s.files()).length, 1, "nothing was written");
    await refused(run(s, a, { params: { ...a.params, text: "third" } }));
    assert.equal((await refused(run(s, a))).status, 403, "now revoked, even with the right parameters");
    assert.equal(existsSync(path.join(s.dir, "note.txt")), false);
    // Swapping the tool for a different one is refused too.
    const b = await approvedWrite(s, { path: "swap.txt", text: "t" });
    const e = await refused(run(s, b, { tool: "read_test_file", params: { path: "swap.txt" } }));
    assert.equal(e.status, 403);
  } finally {
    await s.cleanup();
  }
});

// 8. revocation ----------------------------------------------------------------------------------------------------

test("a revoked key stops new requests at once and cancels an approval it had not used yet", async () => {
  const s = await setup();
  try {
    const req = (key: string) => new Request("http://tend.test/", { headers: { authorization: `Bearer ${key}` } });
    assert.ok(await authAgent(s.db, req(s.key)));
    const a = await approvedWrite(s);
    await revokeKey(s.db, s.agent.id);
    const e = await refused(authAgent(s.db, req(s.key)));
    assert.equal(e.status, 401);
    const e2 = await refused(run(s, a));
    assert.equal(e2.status, 403);
    assert.equal(existsSync(path.join(s.dir, "note.txt")), false);
  } finally {
    await s.cleanup();
  }
});

test("pausing or disabling the agent after approval blocks execution", async () => {
  const s = await setup();
  try {
    const a = await approvedWrite(s);
    const { control } = await import("./repo.ts");
    await control(s.db, s.agent.id, "pause");
    assert.equal((await refused(run(s, a))).code, "not_permitted");
    assert.equal(existsSync(path.join(s.dir, "note.txt")), false);
  } finally {
    await s.cleanup();
  }
});

// 9. gateway / database failure ------------------------------------------------------------------------------------

function failing(db: DB, broken: () => RegExp | undefined): DB {
  const wrap = (q: Q): Q => {
    const guard = (sql: string) => {
      if (broken()?.test(sql)) throw new Error("simulated database failure");
    };
    return { ...q, all: (sql, ...p) => (guard(sql), q.all(sql, ...p)), get: (sql, ...p) => (guard(sql), q.get(sql, ...p)), run: (sql, ...p) => (guard(sql), q.run(sql, ...p)) } as Q;
  };
  return { ...wrap(db), kind: db.kind, tx: (fn) => db.tx((q) => fn(wrap(q))), close: () => db.close() } as DB;
}

test("if the database fails while the approval is spent, nothing is written; when it recovers it runs exactly once", async () => {
  const s = await setup();
  try {
    let broken: RegExp | undefined;
    const flaky = failing(s.db, () => broken);
    const a = await approvedWrite(s);
    broken = /status = 'consumed'/;
    await assert.rejects(executeTool(flaky, s.agent, { authorizationId: a.id, token: a.token, tool: "write_test_file", params: a.params }), /simulated/);
    assert.equal(existsSync(path.join(s.dir, "note.txt")), false);
    broken = undefined;
    assert.equal((await executeTool(flaky, s.agent, { authorizationId: a.id, token: a.token, tool: "write_test_file", params: a.params })).executed, true);
    assert.equal((await refused(run(s, a))).code, "already_consumed");
  } finally {
    await s.cleanup();
  }
});

test("a database that is down when a request is made gives no authorization, so nothing can run", async () => {
  const s = await setup();
  try {
    const flaky = failing(s.db, () => /INSERT INTO authorizations/);
    await assert.rejects(requestExecution(flaky, s.agent, { tool: "write_test_file", params: { path: "x.txt", text: "x" } }, null));
    assert.equal(existsSync(path.join(s.dir, "x.txt")), false);
  } finally {
    await s.cleanup();
  }
});

test("an unconfigured sandbox fails closed before the approval is spent", async () => {
  const s = await setup();
  try {
    const a = await approvedWrite(s);
    delete process.env.TEND_GATEWAY_SANDBOX_DIR;
    assert.equal((await refused(run(s, a))).code, "tool_unavailable");
    process.env.TEND_GATEWAY_SANDBOX_DIR = s.dir;
    assert.equal((await run(s, a)).executed, true, "the approval was not spent by the failed attempt");
  } finally {
    await s.cleanup();
  }
});

// 10. concurrency --------------------------------------------------------------------------------------------------

test("eight concurrent executions of one approval: exactly one write happens", async () => {
  const s = await setup();
  try {
    const a = await approvedWrite(s);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => run(s, a)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(readFileSync(path.join(s.dir, "note.txt"), "utf8"), "approved text\n");
    assert.equal((await outcomes(s.db)).filter((o) => o.outcome === "success").length, 1);
  } finally {
    await s.cleanup();
  }
});

// 11. cross-agent --------------------------------------------------------------------------------------------------

test("another agent cannot claim or spend this agent's approval", async () => {
  const s = await setup();
  try {
    const a = await approvedWrite(s);
    assert.equal((await refused(claimToken(s.db, s.other, a.id))).status, 404);
    const e = await refused(executeTool(s.db, s.other, { authorizationId: a.id, token: a.token, tool: "write_test_file", params: a.params }));
    assert.equal(e.status, 404);
    assert.equal(existsSync(path.join(s.dir, "note.txt")), false);
    // Policy is per agent: an agent with no rules is denied the same read.
    await setPolicy(s.db, s.other.id, [], "enforce");
    assert.equal((await ask(s, "read_test_file", { path: "seed.txt" }, s.other)).view.status, "denied");
  } finally {
    await s.cleanup();
  }
});

// 12. audit log ----------------------------------------------------------------------------------------------------

test("the audit trail names every decision and outcome, and never holds a token, the sandbox path or file text beyond the bound fields", async () => {
  const s = await setup();
  try {
    await fresh(s, "delete_test_file", { path: "seed.txt" });
    const a = await approvedWrite(s);
    await run(s, a);
    await refused(run(s, a));
    const types = (await s.db.all<{ type: string }>("SELECT type FROM events ORDER BY seq")).map((r) => r.type);
    for (const t of ["authorization.requested", "authorization.denied", "review.decided", "authorization.consumed", "tool.called", "alert.raised"])
      assert.ok(types.includes(t), `missing ${t}: ${types}`);
    const all = (await s.db.all<{ data: string }>("SELECT data FROM events")).map((r) => r.data).join("\n");
    assert.equal(all.includes(a.token), false);
    assert.equal(all.includes(s.dir), false, "the sandbox location is the gateway's secret");
    assert.equal(all.includes(s.key), false);
    const o = await outcomes(s.db);
    assert.deepEqual(o.map((x) => x.outcome), ["success", "denied"]);
    assert.ok(o.every((x) => x.authorizationId && x.tool === "write_test_file"));
  } finally {
    await s.cleanup();
  }
});

// 13. path traversal -----------------------------------------------------------------------------------------------

test("no path other than one plain file name is accepted, for all three tools", async () => {
  const s = await setup();
  try {
    const bad = [
      "../secret.txt", "..", ".", "../../etc/passwd", "/etc/passwd", "a/b.txt", "sub/../seed.txt", "..\\secret.txt", "C:\\x.txt", "~/x", "~root",
      "%2e%2e%2fsecret.txt", "..%2fsecret.txt", "seed.txt\0.png", "seed.txt/", "./seed.txt", ".hidden", "a..b", "a.b.c", "seed.txt ", " seed.txt",
      "seed.txt\n", "sé.txt", "x".repeat(60), "", "file:///etc/passwd", "https://evil.example/x", "$(id)", "a;b", "a|b", "*", "?",
    ];
    for (const tool of ["read_test_file", "write_test_file", "delete_test_file"])
      for (const p of bad) {
        const params = tool === "write_test_file" ? { path: p, text: "x" } : { path: p };
        const e = await refused(requestExecution(s.db, s.agent, { tool, params }, null));
        assert.equal(e.code, "invalid_params", `${tool} ${JSON.stringify(p)}`);
      }
    for (const params of [{}, { path: 5 }, { path: ["seed.txt"] }, { path: "seed.txt", dir: "/" }, { file: "seed.txt" }, null, "seed.txt"])
      assert.equal((await refused(requestExecution(s.db, s.agent, { tool: "read_test_file", params }, null))).code, "invalid_params", JSON.stringify(params));
    assert.deepEqual(Object.keys(s.files()), ["seed.txt"]);
    assert.equal(readFileSync(path.join(s.outside, "secret.txt"), "utf8"), "OUTSIDE SECRET\n");
  } finally {
    await s.cleanup();
  }
});

test("a symlink planted inside the sandbox cannot read, overwrite or delete anything outside it", async () => {
  const s = await setup([{ tool: "read_test_file", action: "read", effect: "allow" }, { tool: "write_test_file", action: "create", effect: "allow" }, { tool: "delete_test_file", action: "delete", effect: "allow" }]);
  try {
    symlinkSync(path.join(s.outside, "secret.txt"), path.join(s.dir, "link.txt"));
    symlinkSync(s.outside, path.join(s.dir, "linkdir"));
    const go = async (tool: string, params: object) => {
      const view = await fresh(s, tool, params);
      const { token } = (await claimToken(s.db, s.agent, view.id)).view as unknown as { token: string };
      return executeTool(s.db, s.agent, { authorizationId: view.id, token, tool, params });
    };
    assert.equal((await refused(go("read_test_file", { path: "link.txt" }))).code, "execution_failed");
    assert.equal((await refused(go("write_test_file", { path: "link.txt", text: "pwned" }))).code, "execution_failed");
    assert.equal((await refused(go("delete_test_file", { path: "link.txt" }))).code, "execution_failed");
    assert.equal((await refused(go("read_test_file", { path: "linkdir" }))).code, "execution_failed", "a directory is not a file");
    assert.equal(readFileSync(path.join(s.outside, "secret.txt"), "utf8"), "OUTSIDE SECRET\n");
    assert.deepEqual(readdirSync(s.outside), ["secret.txt"]);
    // Files in a real subfolder are unreachable too: the name has no separator.
    mkdirSync(path.join(s.dir, "sub"));
    writeFileSync(path.join(s.dir, "sub", "inner.txt"), "inner\n");
    assert.equal((await refused(requestExecution(s.db, s.agent, { tool: "read_test_file", params: { path: "sub/inner.txt" } }, null))).code, "invalid_params");
  } finally {
    await s.cleanup();
  }
});

test("when the sandbox directory itself is a symlink, files resolve inside its real location only", async () => {
  const s = await setup();
  try {
    const alias = path.join(s.outside, "alias");
    symlinkSync(s.dir, alias);
    process.env.TEND_GATEWAY_SANDBOX_DIR = alias;
    const view = await fresh(s, "read_test_file", { path: "seed.txt" });
    const { token } = (await claimToken(s.db, s.agent, view.id)).view as unknown as { token: string };
    assert.equal((await executeTool(s.db, s.agent, { authorizationId: view.id, token, tool: "read_test_file", params: { path: "seed.txt" } })).executed, true);
  } finally {
    await s.cleanup();
  }
});

test("WRITE never overwrites an existing file, and reads of large files are refused", async () => {
  const s = await setup([{ tool: "write_test_file", action: "create", effect: "allow" }, { tool: "read_test_file", action: "read", effect: "allow" }]);
  try {
    const go = async (tool: string, params: object) => {
      const view = await fresh(s, tool, params);
      const { token } = (await claimToken(s.db, s.agent, view.id)).view as unknown as { token: string };
      return executeTool(s.db, s.agent, { authorizationId: view.id, token, tool, params });
    };
    assert.equal((await refused(go("write_test_file", { path: "seed.txt", text: "overwrite" }))).code, "execution_failed");
    assert.equal(readFileSync(path.join(s.dir, "seed.txt"), "utf8"), "FICTIONAL seed\n");
    writeFileSync(path.join(s.dir, "big.txt"), "x".repeat(20_000));
    assert.equal((await refused(go("read_test_file", { path: "big.txt" }))).code, "execution_failed");
  } finally {
    await s.cleanup();
  }
});
