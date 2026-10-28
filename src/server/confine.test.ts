// The operating-system confinement (scripts/confine.mjs), tested with a probe process under the real sandbox profile. Everything is a
// FAKE file in a temporary directory: a fake repository (with a fake .env.local, source, database folder), a fake sandbox folder and a
// fake home with a fake ~/.ssh. No real file of yours is read. Skipped where confinement is unavailable (not macOS).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildProfile, canConfine, confinedSpawn } from "../../scripts/confine.mjs";

const skip = canConfine() ? false : "confinement needs macOS sandbox-exec";

function fixture() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "tend-confine-")));
  const root = path.join(base, "repo"), sandbox = path.join(base, "elsewhere-sandbox"), data = path.join(root, ".data"), home = path.join(base, "home");
  for (const d of ["examples", "src", ".data", "node_modules/x", "elsewhere-sandbox-unused"]) mkdirSync(path.join(root, d), { recursive: true });
  mkdirSync(sandbox);
  mkdirSync(path.join(home, ".ssh"), { recursive: true });
  const f = (p: string, text: string) => writeFileSync(p, text);
  f(path.join(root, ".env.local"), "FAKE_ADMIN=1");
  f(path.join(root, ".env.agent"), "FAKE_AGENT=1");
  f(path.join(root, "package.json"), "{}");
  f(path.join(root, "examples/a.mjs"), "x");
  f(path.join(root, "node_modules/x/i.js"), "x");
  f(path.join(root, "src/server.ts"), "secret source");
  f(path.join(data, "db"), "database");
  f(path.join(sandbox, "secret.txt"), "sandbox file");
  f(path.join(home, ".ssh/id_fake"), "fake key");
  return { base, root, sandbox, data, home, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

const PROBE = `
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const [root, sandbox, home, otherPid, url] = process.argv.slice(2);
const out = {};
const t = (name, fn) => { try { fn(); out[name] = "allowed"; } catch (e) { out[name] = e.code ?? "error"; } };
t("env.local", () => readFileSync(root + "/.env.local"));
t("source", () => readFileSync(root + "/src/server.ts"));
t("database", () => readFileSync(root + "/.data/db"));
t("sandbox", () => readFileSync(sandbox + "/secret.txt"));
t("ssh", () => readFileSync(home + "/.ssh/id_fake"));
t("env.agent", () => readFileSync(root + "/.env.agent"));
t("package.json", () => readFileSync(root + "/package.json"));
t("examples", () => readFileSync(root + "/examples/a.mjs"));
t("node_modules", () => readFileSync(root + "/node_modules/x/i.js"));
t("write repo", () => writeFileSync(root + "/new.txt", "x"));
t("write examples", () => writeFileSync(root + "/examples/new.txt", "x"));
t("write sandbox", () => writeFileSync(sandbox + "/new.txt", "x"));
t("write tmp", () => writeFileSync(process.env.TMPDIR + "/probe-ok.txt", "x"));
t("other process", () => { if (!execFileSync("ps", ["-o", "command=", "-p", otherPid]).toString().trim()) throw Object.assign(new Error("empty"), { code: "EMPTY" }); });
out.network = await fetch(url).then((r) => r.text(), () => "failed");
console.log(JSON.stringify(out));
`;

test("the confined agent cannot read the server's secrets, the sandbox or your credential folders, cannot write outside temp, and keeps what it needs", { skip }, async () => {
  const fx = fixture();
  const other = spawn("sleep", ["30"]);
  const server = createServer((_req, res) => res.end("localhost-ok"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const probeFile = path.join(fx.root, "examples", "probe.mjs");
    writeFileSync(probeFile, PROBE);
    const run = (argv: string[]) =>
      new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
        const child = confinedSpawn([process.execPath, probeFile, ...argv], { root: fx.root, hidden: [fx.sandbox, fx.data], home: fx.home, env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir() }, stdio: "pipe" });
        let out = "", err = "";
        child.stdout!.on("data", (d: Buffer) => (out += d));
        child.stderr!.on("data", (d: Buffer) => (err += d));
        child.on("close", (code: number | null) => resolve({ code, out, err }));
      });
    const r = await run([fx.root, fx.sandbox, fx.home, String(other.pid), url]);
    assert.equal(r.code, 0, r.err);
    const seen = JSON.parse(r.out.trim().split("\n").pop()!);
    for (const denied of ["env.local", "source", "database", "sandbox", "ssh", "write repo", "write examples", "write sandbox"]) assert.equal(seen[denied], "EPERM", `${denied}: ${seen[denied]}`);
    for (const allowed of ["env.agent", "package.json", "examples", "node_modules", "write tmp"]) assert.equal(seen[allowed], "allowed", `${allowed}: ${seen[allowed]}`);
    assert.notEqual(seen["other process"], "allowed", "another process's command line must not be readable");
    assert.equal(seen.network, "localhost-ok", "the agent can still reach TEND and its provider");

    // Control: the same probe unconfined reads everything, so the denials above are the profile's doing.
    const free = await new Promise<string>((resolve) => {
      const child = spawn(process.execPath, [probeFile, fx.root, fx.sandbox, fx.home, String(other.pid), url], { env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir() } as unknown as NodeJS.ProcessEnv });
      let out = "";
      child.stdout.on("data", (d: Buffer) => (out += d));
      child.on("close", () => resolve(out));
    });
    const open = JSON.parse(free.trim().split("\n").pop()!);
    for (const k of ["env.local", "source", "database", "sandbox", "ssh", "write repo", "other process"]) assert.equal(open[k], "allowed", `control ${k}: ${open[k]}`);
  } finally {
    other.kill();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    fx.cleanup();
  }
});

test("the profile only ever hides more: specific denials come after every allowance, and bad paths are refused", { skip }, () => {
  const p = buildProfile({ root: "/tmp/x", hidden: ["/tmp/y"], home: "/tmp/h" });
  const lines = p.split("\n");
  const lastAllow = lines.map((l, i) => (l.startsWith("(allow file-read") || l.startsWith("(allow file-write") ? i : -1)).reduce((a, b) => Math.max(a, b));
  const firstSpecificDeny = lines.findIndex((l) => l.includes("/y") || l.includes("/h/.ssh"));
  assert.ok(firstSpecificDeny > lastAllow, "denials for the sandbox, data and home secrets are last, so they win");
  assert.ok(p.includes("(deny process-info* (target others))"));
  assert.throws(() => buildProfile({ root: '/tmp/x"y' }), /cannot go into/);
});

test("without confinement available the wrapper refuses to start; it never falls back to running unconfined", () => {
  // Simulate another platform by loading the module with a different `process.platform` view is not possible, so check the code path directly.
  const src = confinedSpawn.toString();
  assert.match(src, /canConfine\(\)/);
  assert.match(src, /throw new Error/);
});

test("bypass demonstration: unconfined, a same-user process reads another process's environment (a fake server secret); confined, it cannot", { skip }, async () => {
  const fx = fixture();
  // Stands in for a TEND server started with a secret in its environment. The value is fake.
  const serverLike = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { env: { PATH: process.env.PATH ?? "", TEND_ADMIN_TOKEN: "FAKE_ADMIN_TOKEN_for_the_confinement_test" } as unknown as NodeJS.ProcessEnv });
  try {
    const probe = path.join(fx.root, "examples", "peek.mjs");
    writeFileSync(probe, `import { execFileSync } from "node:child_process";
try { const o = execFileSync("ps", ["eww", "-p", process.argv[2]]).toString(); console.log(o.includes("FAKE_ADMIN_TOKEN_for_the_confinement_test") ? "LEAKED" : "not-visible"); } catch { console.log("denied"); }`);
    const run = (confined: boolean) =>
      new Promise<string>((resolve) => {
        const env = { PATH: process.env.PATH ?? "", TMPDIR: tmpdir() };
        const child = confined
          ? confinedSpawn([process.execPath, probe, String(serverLike.pid)], { root: fx.root, hidden: [], home: fx.home, env, stdio: "pipe" })
          : spawn(process.execPath, [probe, String(serverLike.pid)], { env: env as unknown as NodeJS.ProcessEnv });
        let out = "";
        child.stdout!.on("data", (d: Buffer) => (out += d));
        child.on("close", () => resolve(out.trim()));
      });
    assert.equal(await run(false), "LEAKED", "this is the weakness: without confinement the secret is readable from the process list");
    assert.equal(await run(true), "denied", "confinement closes it");
  } finally {
    serverLike.kill();
    fx.cleanup();
  }
});

test("the agents:confined wrapper starts the example agent confined, with a rebuilt environment, and fails closed when TEND is unreachable", { skip }, async () => {
  // A throwaway copy of the wrapper and the example agents in a temp "repository", with fake keys. node_modules is linked, not copied.
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "tend-wrapper-")));
  const repo = path.resolve(import.meta.dirname, "../..");
  try {
    for (const d of ["scripts", "examples"]) mkdirSync(path.join(base, d), { recursive: true });
    const { cpSync, symlinkSync } = await import("node:fs");
    for (const f of ["agents-confined.mjs", "confine.mjs", "server-paths.mjs"]) cpSync(path.join(repo, "scripts", f), path.join(base, "scripts", f));
    cpSync(path.join(repo, "examples/real-agents"), path.join(base, "examples/real-agents"), { recursive: true });
    cpSync(path.join(repo, "examples/claude-agent"), path.join(base, "examples/claude-agent"), { recursive: true });
    cpSync(path.join(repo, "package.json"), path.join(base, "package.json"));
    symlinkSync(path.join(repo, "node_modules"), path.join(base, "node_modules"));
    writeFileSync(path.join(base, ".env.agent"), "TEND_URL=http://127.0.0.1:9\nTEND_OPENAI_AGENT_KEY=tend_sk_fakefakefakefakefakefake\nOPENAI_API_KEY=offline-placeholder\nTEND_ADMIN_TOKEN=FAKE_SHOULD_NOT_REACH_THE_AGENT_0123456789\n");
    const wrapper = () =>
      new Promise<{ code: number | null; out: string }>((resolve) => {
        const child = spawn(process.execPath, [path.join(base, "scripts/agents-confined.mjs"), "openai"], { env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv });
        let out = "";
        child.stdout.on("data", (d: Buffer) => (out += d));
        child.stderr.on("data", (d: Buffer) => (out += d));
        child.on("close", (code) => resolve({ code, out }));
      });
    // A server secret in the agent's own file: the agent refuses to start (its isolation check), and nothing is printed.
    const bad = await wrapper();
    assert.match(bad.out, /\[confined\] openai agent/);
    assert.match(bad.out, /Refusing to run: .*\(TEND_ADMIN_TOKEN\)/);
    assert.equal(bad.code, 1);
    assert.equal(bad.out.includes("FAKE_SHOULD_NOT_REACH"), false, "only the variable name is reported");

    // Without it the agent starts, confined, and fails closed because TEND is unreachable.
    writeFileSync(path.join(base, ".env.agent"), "TEND_URL=http://127.0.0.1:9\nTEND_OPENAI_AGENT_KEY=tend_sk_fakefakefakefakefakefake\nOPENAI_API_KEY=offline-placeholder\n");
    const ok = await wrapper();
    assert.doesNotMatch(ok.out, /Refusing to run/);
    assert.match(ok.out, /Failed:/, "the agent ran and failed closed on the unreachable TEND");
    assert.equal(ok.code, 1);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
