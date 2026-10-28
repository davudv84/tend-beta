// The isolated test server (scripts/isolated-server.mjs) used by `npm run agents:try` and the offline e2e. It must obey only what it is given:
// `next start` loads .env.local from the folder it runs in, so a DATABASE_URL (or any TEND_* setting) in YOUR .env.local used to reconfigure the
// "isolated" server. These tests use a FAKE project root with a hostile fake .env.local; your real files are not read. They need the production
// build (`npm run build`) and are skipped without it.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { freePort, listeners, processTree, startIsolatedServer } from "../../scripts/isolated-server.mjs";

const repo = path.resolve(import.meta.dirname, "../..");
const skip = existsSync(path.join(repo, ".next/BUILD_ID")) ? false : "needs `npm run build`";
const ADMIN = `fake_admin_${randomBytes(24).toString("hex")}`; // production mode refuses weak tokens, so the fake one must be random

/** A project root that looks like the repository but is a temp folder, with a hostile .env.local. */
function fakeRoot() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "tend-fakeroot-")));
  for (const n of [".next", "node_modules", "package.json", "next.config.ts"]) symlinkSync(path.join(repo, n), path.join(root, n));
  writeFileSync(path.join(root, ".env.local"), ["DATABASE_URL=postgres://nobody:nopass@127.0.0.1:1/none", "POSTGRES_URL=postgres://nobody:nopass@127.0.0.1:1/none", "TEND_TRUSTED_PROXY=3", "TEND_GATEWAY_NOTES_DIR=/nonexistent", "TEND_ADMIN_TOKEN=hostile_token_from_env_local_0123456789", "TEND_PUBLIC=1", "TEND_DEMO=1", ""].join("\n"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("a hostile .env.local cannot reconfigure the isolated server: embedded temp database, its own admin token, a key authenticates", { skip }, async () => {
  const fx = fakeRoot();
  const data = mkdtempSync(path.join(tmpdir(), "tend-iso-data-"));
  const sandbox = mkdtempSync(path.join(tmpdir(), "tend-iso-sb-"));
  const server = await startIsolatedServer({ root: fx.root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_GATEWAY_SANDBOX_DIR: sandbox, TEND_DATA_DIR: data } });
  try {
    assert.equal(server.health.storage, "embedded", "DATABASE_URL from .env.local was ignored");
    const call = (method: string, p: string, o: { body?: unknown; cookie?: string; key?: string } = {}) =>
      fetch(server.url + p, { method, headers: { ...(o.body ? { "content-type": "application/json" } : {}), ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.key ? { authorization: `Bearer ${o.key}` } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
    // the hostile admin token is not the one in force; the one we passed is
    assert.equal((await call("POST", "/api/operator/session", { body: { token: "hostile_token_from_env_local_0123456789" } })).status, 401);
    const login = await call("POST", "/api/operator/session", { body: { token: ADMIN } });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    // TEND_PUBLIC=1 in the file would let visitors in; it is off
    assert.equal((await call("GET", "/api/v1/state")).status, 401, "a visitor sees nothing");
    // TEND_DEMO=1 in the file would seed simulated agents; it is off
    const state = await (await call("GET", "/api/v1/state", { cookie })).json();
    assert.equal(state.projection.agents.filter((a: { origin: string }) => a.origin === "demo").length, 0);
    // a key issued by this server authenticates on this server, immediately
    const reg = await (await call("POST", "/api/v1/agents", { cookie, body: { name: "Iso agent", model: "m", provider: "OpenAI" } })).json();
    assert.equal((await call("GET", "/api/v1/agent/inbox", { key: reg.apiKey })).status, 200);
    assert.equal((await call("GET", "/api/v1/agent/inbox", { key: `tend_sk_${"x".repeat(32)}` })).status, 401);
  } finally {
    await server.stop();
    fx.cleanup();
    rmSync(data, { recursive: true, force: true });
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("stop() ends the whole process tree and frees the port (no stale next-server left to answer for a later run)", { skip }, async () => {
  const fx = fakeRoot();
  const data = mkdtempSync(path.join(tmpdir(), "tend-iso-data-"));
  const server = await startIsolatedServer({ root: fx.root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: data, TEND_GATEWAY_SANDBOX_DIR: data } });
  const { port } = server;
  const pids = server.pids();
  try {
    assert.ok(pids.length >= 1 && listeners(port).every((p) => pids.includes(p)), "the port is held by this server's own tree");
    await server.stop();
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual(listeners(port), [], "nothing listens on the port any more");
    for (const p of pids) assert.throws(() => process.kill(p, 0), "process still alive: " + p);
  } finally {
    await server.stop();
    fx.cleanup();
    rmSync(data, { recursive: true, force: true });
  }
});

test("ports come from the operating system, so a stale listener can never be mistaken for the new server", async () => {
  const taken = createServer();
  await new Promise<void>((r) => taken.listen(0, "127.0.0.1", r));
  const heldPort = (taken.address() as { port: number }).port;
  try {
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) seen.add(await freePort());
    assert.equal(seen.has(heldPort), false);
    assert.deepEqual(listeners(heldPort), [process.pid]);
    assert.ok(processTree(process.pid).includes(process.pid));
  } finally {
    taken.close();
  }
});

test("the isolated server's port is held only by its own process tree", { skip }, async () => {
  const fx = fakeRoot();
  const data = mkdtempSync(path.join(tmpdir(), "tend-iso-data-"));
  mkdirSync(data, { recursive: true });
  const server = await startIsolatedServer({ root: fx.root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: data, TEND_GATEWAY_SANDBOX_DIR: data } });
  try {
    const mine = new Set(server.pids());
    assert.ok(listeners(server.port).length > 0 && listeners(server.port).every((p) => mine.has(p)));
    assert.equal(listeners(server.port).includes(process.pid), false, "this test process is not the listener, so it would be reported as 'another process'");
  } finally {
    await server.stop();
    fx.cleanup();
    rmSync(data, { recursive: true, force: true });
  }
});
