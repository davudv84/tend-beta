// Local beta hosting (scripts/beta-local.mjs): provisioning, the isolation rules, the tunnel config, and the server confinement profile.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildServerProfile, canConfine } from "../../scripts/confine.mjs";
import { check, loadAll, provision, tunnelConfig } from "../../scripts/beta-local.mjs";

const work = () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tend-betalocal-")));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};
const fails = (r: { level: string; text: string }[]) => r.filter((x) => x.level === "fail").map((x) => x.text);

test("provision: distinct ports, strong distinct tokens, private files and folders, a seed file in each sandbox, and no overwriting", () => {
  const w = work();
  try {
    const made = provision(w.dir, ["alice", "bob", "carol"]);
    assert.deepEqual(made.map((m) => m.port), [4501, 4502, 4503]);
    const { instances, modes } = loadAll(w.dir);
    assert.equal(new Set(Object.values(instances).map((i) => i.TEND_ADMIN_TOKEN)).size, 3);
    assert.ok(Object.values(modes).every((m) => m === 0o600));
    for (const n of ["alice", "bob", "carol"]) {
      for (const sub of ["db", "sandbox"]) assert.equal(statSync(path.join(w.dir, "beta-data", n, sub)).mode & 0o777, 0o700);
      assert.match(readFileSync(path.join(w.dir, "beta-data", n, "sandbox", "hello.txt"), "utf8"), /disposable/);
    }
    assert.deepEqual(fails(check(instances, modes)), []);
    assert.throws(() => provision(w.dir, ["alice"]), /refusing to overwrite/);
    assert.throws(() => provision(w.dir, ["Bad Name"]), /not a usable/);
    assert.deepEqual(provision(w.dir, ["dave"]).map((m) => m.port), [4504], "a later instance gets the next free port");
  } finally {
    w.cleanup();
  }
});

test("check enforces the isolation rules and never echoes a secret", () => {
  const w = work();
  try {
    provision(w.dir, ["alice", "bob"]);
    const { instances } = loadAll(w.dir);
    const a = instances.alice;
    const cases: [string, Record<string, string>, RegExp][] = [
      ["weak token", { ...instances.bob, TEND_ADMIN_TOKEN: "a".repeat(40) }, /TEND_ADMIN_TOKEN is /],
      ["shared token", { ...instances.bob, TEND_ADMIN_TOKEN: a.TEND_ADMIN_TOKEN }, /same as alice/],
      ["shared port", { ...instances.bob, PORT: a.PORT }, /same as alice/],
      ["your dev port", { ...instances.bob, PORT: "3000" }, /not 3000/],
      ["bad port", { ...instances.bob, PORT: "80" }, /PORT must be/],
      ["shared payments key", { ...instances.bob, TEND_GATEWAY_PAYMENTS_KEY: a.TEND_GATEWAY_PAYMENTS_KEY }, /same as alice/],
      ["public", { ...instances.bob, TEND_PUBLIC: "1" }, /TEND_PUBLIC must not be set/],
      ["demo", { ...instances.bob, TEND_DEMO: "1" }, /TEND_DEMO must not be set/],
      ["database url", { ...instances.bob, DATABASE_URL: "postgres://x" }, /DATABASE_URL must not be set/],
      ["local http", { ...instances.bob, TEND_LOCAL_HTTP: "1" }, /TEND_LOCAL_HTTP must not be set/],
    ];
    for (const [name, bob, re] of cases) assert.ok(fails(check({ alice: a, bob })).some((t) => re.test(t)), `${name}: ${fails(check({ alice: a, bob })).join(" | ")}`);
    assert.ok(fails(check(instances, { alice: 0o644, bob: 0o600 })).some((t) => /readable by other accounts/.test(t)));
    const out = JSON.stringify(check({ alice: a, bob: { ...instances.bob, TEND_ADMIN_TOKEN: a.TEND_ADMIN_TOKEN } }));
    assert.equal(out.includes(a.TEND_ADMIN_TOKEN), false);
  } finally {
    w.cleanup();
  }
});

test("the tunnel config maps each tester's own hostname to that tester's own port, and nothing else", () => {
  const cfg = tunnelConfig({ alice: { PORT: "4501" }, bob: { PORT: "4502" } }, "beta.example.com");
  assert.match(cfg, /hostname: alice\.beta\.example\.com\n\s+service: http:\/\/127\.0\.0\.1:4501\n\s+originRequest:\n\s+httpHostHeader: alice\.beta\.example\.com/);
  assert.match(cfg, /hostname: bob\.beta\.example\.com\n\s+service: http:\/\/127\.0\.0\.1:4502\n\s+originRequest:\n\s+httpHostHeader: bob\.beta\.example\.com/);
  assert.match(cfg, /- service: http_status:404\n$/, "anything unlisted gets a 404");
  assert.equal((cfg.match(/hostname:/g) ?? []).length, 2);
  assert.throws(() => tunnelConfig({}, "not a domain"), /not a domain/);
  assert.throws(() => tunnelConfig({}, "localhost"), /not a domain/);
});

const skip = canConfine() ? false : "needs macOS sandbox-exec";
test("a confined server writes only to its own folders and cannot read other instances, the repo's secrets or your credentials (fake files)", { skip }, async () => {
  const w = work();
  try {
    const root = path.join(w.dir, "repo"), home = path.join(w.dir, "home");
    const mine = path.join(w.dir, "beta-data/alice"), theirs = path.join(w.dir, "beta-data/bob");
    for (const d of [root, `${root}/.next/cache`, `${root}/.git`, `${root}/beta-envs`, `${root}/beta-data/alice`, `${root}/beta-data/bob`, `${home}/.ssh`, `${root}/src`]) mkdirSync(d, { recursive: true });
    const aliceDir = path.join(root, "beta-data/alice"), bobDir = path.join(root, "beta-data/bob");
    const f = (p: string, t: string) => writeFileSync(p, t);
    f(`${root}/.env.local`, "FAKE"); f(`${root}/.git/config`, "FAKE"); f(`${root}/beta-envs/secret`, "FAKE"); f(`${bobDir}/db`, "BOB"); f(`${aliceDir}/db`, "ALICE"); f(`${home}/.ssh/id`, "FAKE"); f(`${root}/src/a.ts`, "code");
    void mine; void theirs;
    const profile = buildServerProfile({ root, allowWrite: [aliceDir], hidden: [], home });
    const probe = path.join(w.dir, "probe.mjs");
    f(probe, `import { readFileSync, writeFileSync } from "node:fs";
const out = {}; const t = (n, fn) => { try { fn(); out[n] = "allowed"; } catch (e) { out[n] = e.code ?? "error"; } };
t("read own", () => readFileSync("${aliceDir}/db")); t("write own", () => writeFileSync("${aliceDir}/new", "x"));
t("read other instance", () => readFileSync("${bobDir}/db")); t("write other instance", () => writeFileSync("${bobDir}/new", "x"));
t("env.local", () => readFileSync("${root}/.env.local")); t(".git", () => readFileSync("${root}/.git/config")); t("beta-envs", () => readFileSync("${root}/beta-envs/secret"));
t("ssh", () => readFileSync("${home}/.ssh/id")); t("write repo", () => writeFileSync("${root}/src/new", "x")); t("write next cache", () => writeFileSync("${root}/.next/cache/x", "x"));
t("read source", () => readFileSync("${root}/src/a.ts")); t("write tmp", () => writeFileSync(process.env.TMPDIR + "/ok", "x"));
console.log(JSON.stringify(out));`);
    const out = await new Promise<string>((resolve) => {
      const c = spawn("/usr/bin/sandbox-exec", ["-p", profile, process.execPath, probe], { env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir() } as unknown as NodeJS.ProcessEnv });
      let s = "";
      c.stdout.on("data", (d: Buffer) => (s += d));
      c.on("close", () => resolve(s));
    });
    const r = JSON.parse(out.trim().split("\n").pop()!);
    for (const ok of ["read own", "write own", "write next cache", "read source", "write tmp"]) assert.equal(r[ok], "allowed", `${ok}: ${r[ok]}`);
    for (const no of ["read other instance", "write other instance", "env.local", ".git", "beta-envs", "ssh", "write repo"]) assert.equal(r[no], "EPERM", `${no}: ${r[no]}`);
    assert.ok(existsSync(`${aliceDir}/new`) && !existsSync(`${bobDir}/new`));
    void chmodSync; void symlinkSync;
  } finally {
    w.cleanup();
  }
});
