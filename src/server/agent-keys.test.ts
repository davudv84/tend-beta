// Regression tests for "401 invalid_key right after `npm run agents:setup` reported success".
//
// Root cause (reproduced with the old script): setup rotated an existing agent's key on the server, which destroys the old key in the
// same step, and only afterwards tried to save the new one. When that save failed (read-only or foreign-owned .env.agent), setup had
// already printed "Updated …" and the file still held the old, now dead key, so every agent run answered 401. It also rotated on every
// run, ended keys that were still in use, and never checked that what it saved actually worked. Server-side creation, hashing, storage
// and validation were checked on a real `next dev` and `next start` server, across SIGKILL and restart, and are not at fault.
//
// Here the real key lifecycle (registerAgent, rotateKey, hashing, authAgent) runs on an in-memory database; only the disk and the
// transport are replaced, so failures can be injected at exactly the steps that matter.
import assert from "node:assert/strict";
import { test } from "node:test";
import { explainRejectedKey, keyPrefix, resolveAgent } from "../../examples/real-agents/env.mjs";
import { checkAgents, setupAgents, type SetupApi, type SetupFiles } from "../../scripts/real-agent-setup-lib.mjs";
import { SUGGESTED_POLICY } from "../../scripts/suggested-policy.mjs";
import { authAgent } from "./agent-auth.ts";
import { memoryDb } from "./db.ts";
import { policyView } from "./permissions.ts";
import { allAgents, registerAgent, rotateKey, setPolicy } from "./repo.ts";

const AGENTS = {
  openai: { name: "OpenAI test agent", model: "gpt-4.1-mini", provider: "OpenAI", envVar: "TEND_OPENAI_AGENT_KEY" },
  anthropic: { name: "Claude test agent", model: "claude-haiku-4-5", provider: "Anthropic", envVar: "TEND_ANTHROPIC_AGENT_KEY" },
};
const URL_ = "http://localhost:3000";

async function fixture() {
  const db = await memoryDb();
  const calls: string[] = [];
  const fail: { policyFor?: string; keyStatus?: number; saveOnce?: boolean } = {};
  // The real server logic behind the same interface the CLI uses over HTTP.
  const api: SetupApi = {
    url: URL_,
    signIn: async () => void calls.push("signIn"),
    state: async () => ({ projection: { agents: (await allAgents(db)).map((a) => ({ id: a.id, name: a.name, origin: a.origin })) } }),
    register: async (body) => {
      calls.push("register");
      const r = await registerAgent(db, body);
      return { id: r.agent.id, apiKey: r.apiKey };
    },
    rotate: async (id) => {
      calls.push("rotate");
      return (await rotateKey(db, id)).apiKey;
    },
    setPolicy: async (id, rules) => {
      calls.push(`policy:${id}`);
      if (fail.policyFor === id) throw new Error("policy refused (injected)");
      await setPolicy(db, id, rules, "enforce");
    },
    policyView: async (id) => policyView(db, id),
    // Authentication exactly as an agent request is authenticated: header parsing, hashing, lookup, rate limit.
    keyStatus: async (key, url) => {
      calls.push("keyStatus");
      if (url && url !== URL_) return 0; // the key is tested where the agent would send it: any other address is a different server

      if (fail.keyStatus !== undefined) return fail.keyStatus;
      try {
        await authAgent(db, new Request(`${URL_}/api/v1/agent/inbox`, { headers: { authorization: `Bearer ${key}` } }));
        return 200;
      } catch (e) {
        return (e as { status?: number }).status ?? 0;
      }
    },
  };
  let disk: Record<string, string> = {};
  const writes: Record<string, string>[] = [];
  const state = { writable: true };
  const files: SetupFiles = {
    writable() {
      if (!state.writable) throw new Error("EACCES (injected)");
    },
    read: () => ({ ...disk }),
    write(obj) {
      if (!state.writable || fail.saveOnce) {
        fail.saveOnce = false;
        throw new Error("EACCES (injected)");
      }
      disk = { ...obj };
      writes.push({ ...obj });
    },
  };
  const resolve = (provider: string) => resolveAgent({ env: { ...disk }, fromFile: { ...disk }, fromShell: {} }, provider);
  const run = (o: { wanted?: string[]; rotate?: boolean } = {}) => setupAgents({ api, files, resolve, agents: AGENTS, policy: SUGGESTED_POLICY, wanted: o.wanted ?? ["openai", "anthropic"], rotate: o.rotate });
  const count = (what: string) => calls.filter((c) => c === what).length;
  return { db, api, files, resolve, run, calls, count, fail, state, disk: () => disk, writes };
}
const works = async (f: Awaited<ReturnType<typeof fixture>>, key: string) => (await f.api.keyStatus(key)) === 200;

test("a first run registers both agents, saves each key, and the saved keys authenticate", async () => {
  const f = await fixture();
  try {
    const r = await f.run();
    assert.deepEqual(r.map((x) => [x.provider, x.action, x.verified]), [["openai", "registered", true], ["anthropic", "registered", true]]);
    for (const v of ["TEND_OPENAI_AGENT_KEY", "TEND_ANTHROPIC_AGENT_KEY"]) assert.ok(await works(f, f.disk()[v]), `${v} authenticates`);
    assert.equal(f.disk().TEND_URL, URL_, "the file records which TEND issued the keys");
    assert.notEqual(f.disk().TEND_OPENAI_AGENT_KEY, f.disk().TEND_ANTHROPIC_AGENT_KEY);
  } finally {
    await f.db.close();
  }
});

test("a re-run keeps keys that still work: nothing is rotated, so agents and shells holding them are not broken", async () => {
  const f = await fixture();
  try {
    await f.run();
    const before = { ...f.disk() };
    const r = await f.run();
    assert.deepEqual(r.map((x) => x.action), ["kept", "kept"]);
    assert.equal(f.count("rotate"), 0);
    assert.deepEqual(f.disk(), before, "the file is unchanged");
    assert.equal((await f.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM events WHERE type = 'key.rotated'"))!.n, 0);
    assert.ok(await works(f, before.TEND_OPENAI_AGENT_KEY));
  } finally {
    await f.db.close();
  }
});

test("a saved key that TEND no longer accepts is replaced, saved at once, and works", async () => {
  const f = await fixture();
  try {
    await f.run();
    const stale = f.disk().TEND_OPENAI_AGENT_KEY;
    await rotateKey(f.db, "openai-test-agent"); // someone rotated it elsewhere (the dashboard, another setup run)
    assert.equal(await works(f, stale), false);
    const r = await f.run({ wanted: ["openai"] });
    assert.equal(r[0].action, "rotated");
    assert.notEqual(f.disk().TEND_OPENAI_AGENT_KEY, stale);
    assert.ok(await works(f, f.disk().TEND_OPENAI_AGENT_KEY));
  } finally {
    await f.db.close();
  }
});

test("--rotate ends the old key on purpose and saves the new one", async () => {
  const f = await fixture();
  try {
    await f.run();
    const old = f.disk().TEND_ANTHROPIC_AGENT_KEY;
    const r = await f.run({ rotate: true });
    assert.deepEqual(r.map((x) => x.action), ["rotated", "rotated"]);
    assert.equal(await works(f, old), false, "the old key is dead, as a rotation promises");
    assert.ok(await works(f, f.disk().TEND_ANTHROPIC_AGENT_KEY));
  } finally {
    await f.db.close();
  }
});

test("if the key file cannot be written, nothing is changed on the server (the original bug started here)", async () => {
  const f = await fixture();
  try {
    await f.run();
    const key = f.disk().TEND_OPENAI_AGENT_KEY;
    f.state.writable = false;
    const callsBefore = f.calls.length;
    await assert.rejects(f.run({ rotate: true }), /EACCES/);
    assert.equal(f.calls.length, callsBefore, "no server call was made after the failed preflight");
    f.state.writable = true;
    assert.ok(await works(f, key), "the key on disk still works");
  } finally {
    await f.db.close();
  }
});

test("a key is on disk the moment it is issued: a failure in a later step cannot lose it", async () => {
  const f = await fixture();
  try {
    f.fail.policyFor = "claude-test-agent"; // the second agent's policy step fails after its key was issued
    await assert.rejects(f.run(), /policy refused/);
    assert.ok(await works(f, f.disk().TEND_OPENAI_AGENT_KEY), "the first agent's key is saved and valid");
    assert.ok(await works(f, f.disk().TEND_ANTHROPIC_AGENT_KEY), "the second agent's key was saved before its policy step and is valid");
    f.fail.policyFor = undefined;
    const again = await f.run();
    assert.deepEqual(again.map((x) => x.action), ["kept", "kept"], "recovery needs no rotation");
  } finally {
    await f.db.close();
  }
});

test("if saving a freshly rotated key fails, the error is reported and the next run recovers", async () => {
  const f = await fixture();
  try {
    await f.run();
    await rotateKey(f.db, "openai-test-agent"); // the saved key is now stale
    f.fail.saveOnce = true; // the save right after the rotation fails (disk full, say)
    await assert.rejects(f.run({ wanted: ["openai"] }), /EACCES/);
    const r = await f.run({ wanted: ["openai"] });
    assert.equal(r[0].action, "rotated");
    assert.ok(await works(f, f.disk().TEND_OPENAI_AGENT_KEY));
  } finally {
    await f.db.close();
  }
});

test("a key is never rotated because TEND was unreachable or busy: only a definite 401 counts", async () => {
  const f = await fixture();
  try {
    await f.run();
    const key = f.disk().TEND_OPENAI_AGENT_KEY;
    for (const status of [0, 429, 500, 503]) {
      f.fail.keyStatus = status;
      await assert.rejects(f.run({ wanted: ["openai"] }), /not rotated/, `HTTP ${status}`);
    }
    f.fail.keyStatus = undefined;
    assert.equal(f.count("rotate"), 0);
    assert.ok(await works(f, key), "the working key survived");
  } finally {
    await f.db.close();
  }
});

test("setup fails loudly if the key the agent would actually use is refused: a stale shell variable shadowing the file", async () => {
  const f = await fixture();
  try {
    await f.run();
    const stale = `tend_sk_${"x".repeat(32)}`;
    // What the agent resolves: the shell's TEND_OPENAI_AGENT_KEY replaces the one in the file.
    const shadowed = (provider: string) => resolveAgent({ env: { ...f.disk(), TEND_OPENAI_AGENT_KEY: stale }, fromFile: { ...f.disk() }, fromShell: { TEND_OPENAI_AGENT_KEY: stale } }, provider);
    const err = await setupAgents({ api: f.api, files: f.files, resolve: shadowed, agents: AGENTS, policy: SUGGESTED_POLICY, wanted: ["openai"] }).then(() => null, (e: Error) => e);
    assert.ok(err, "setup must not claim success");
    assert.match(err.message, /401 invalid_key/);
    assert.match(err.message, /your shell environment/);
    assert.ok(err.message.includes(keyPrefix(stale)));
    assert.equal(err.message.includes(stale), false, "the key itself is never printed");
    assert.match(err.message, /agents:setup -- openai --rotate/);
  } finally {
    await f.db.close();
  }
});

test("the key is tested at the address the agent will use: a TEND_URL pointing at another server fails setup and --check", async () => {
  const f = await fixture();
  try {
    await f.run();
    const elsewhere = (provider: string) => resolveAgent({ env: { ...f.disk(), TEND_URL: "http://localhost:3001" }, fromFile: { ...f.disk() }, fromShell: { TEND_URL: "http://localhost:3001" } }, provider);
    const err = await setupAgents({ api: f.api, files: f.files, resolve: elsewhere, agents: AGENTS, policy: SUGGESTED_POLICY, wanted: ["openai"] }).then(() => null, (e: Error) => e);
    assert.ok(err, "setup must not claim success when the agent would talk to another server");
    const out = await checkAgents({ api: f.api, resolve: elsewhere, agents: AGENTS, wanted: ["openai"] });
    assert.equal(out[0].ok, false);
    assert.match(out[0].warnings.join(" "), /differs from the server the keys in \.env\.agent were issued by/);
  } finally {
    await f.db.close();
  }
});

test("--check reports each key as the agents resolve it and changes nothing", async () => {
  const f = await fixture();
  try {
    await f.run();
    await rotateKey(f.db, "claude-test-agent");
    const before = { calls: f.calls.length, disk: { ...f.disk() } };
    const out = await checkAgents({ api: f.api, resolve: f.resolve, agents: AGENTS, wanted: ["openai", "anthropic"] });
    assert.deepEqual(out.map((o) => [o.provider, o.ok, o.status]), [["openai", true, 200], ["anthropic", false, 401]]);
    assert.match(out[1].text, /rejected this agent's key \(401 invalid_key\)/);
    assert.deepEqual(f.disk(), before.disk);
    assert.equal(f.calls.slice(before.calls).every((c) => c === "keyStatus"), true, "only authentication probes were made");
    const none = await checkAgents({ api: f.api, resolve: () => ({ url: URL_, warnings: [] }), agents: AGENTS, wanted: ["openai"] });
    assert.match(none[0].text, /no key found/);
  } finally {
    await f.db.close();
  }
});

test("key resolution: the provider's key beats the generic one, the shell beats the file, and shadowing is called out", () => {
  const file = { TEND_OPENAI_AGENT_KEY: "tend_sk_FILE0000000000000000000000000000", TEND_URL: "http://localhost:3000" };
  const a = resolveAgent({ env: { ...file }, fromFile: file, fromShell: {} }, "openai");
  assert.deepEqual([a.source, a.variable, a.warnings], [".env.agent", "TEND_OPENAI_AGENT_KEY", []]);

  const generic = { TEND_AGENT_KEY: "tend_sk_GENERIC00000000000000000000000000" };
  const b = resolveAgent({ env: { ...file, ...generic }, fromFile: file, fromShell: generic }, "openai");
  assert.equal(b.variable, "TEND_OPENAI_AGENT_KEY", "the provider's own saved key wins over a stray generic variable");

  const shell = { TEND_OPENAI_AGENT_KEY: "tend_sk_SHELL000000000000000000000000000" };
  const c = resolveAgent({ env: { ...file, ...shell }, fromFile: file, fromShell: shell }, "openai");
  assert.equal(c.source, "your shell environment");
  assert.match(c.warnings.join(" "), /in your shell is different from the one in \.env\.agent and replaces it/);

  const other = { TEND_URL: "http://localhost:3001" };
  const d = resolveAgent({ env: { ...file, ...other }, fromFile: file, fromShell: other }, "openai");
  assert.match(d.warnings.join(" "), /differs from the server the keys in \.env\.agent were issued by/);
  assert.equal(d.url, "http://localhost:3001");

  const e = resolveAgent({ env: { ...generic }, fromFile: {}, fromShell: generic }, "anthropic");
  assert.match(e.warnings.join(" "), /Using TEND_AGENT_KEY from your shell/);
  assert.equal(resolveAgent({ env: {}, fromFile: {}, fromShell: {} }, "openai").key, undefined);
});

test("the explanation of a rejected key names the cause and the fix, and never contains the key", () => {
  const key = `tend_sk_${"Q".repeat(32)}`;
  const msg = explainRejectedKey({ key, source: ".env.agent", url: URL_ }, "openai");
  for (const part of ["401 invalid_key", URL_, ".env.agent", "rotated or revoked", "different TEND server or database", "agents:setup -- --check", "agents:setup -- openai --rotate"]) assert.ok(msg.includes(part), part);
  assert.ok(msg.includes(keyPrefix(key)));
  assert.equal(msg.includes(key), false);
});
