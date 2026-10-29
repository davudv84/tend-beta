import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exported, scan } from "../../scripts/tester-export.mjs";

const repo = path.resolve(import.meta.dirname, "../..");
const run = (script: string, ...args: string[]) => spawnSync("node", [path.join(repo, "scripts", script), ...args], { encoding: "utf8" });

test("tester:init writes a private config with a fresh strong token, never prints it, and never overwrites", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tend-init-"));
  try {
    const a = run("tester-init.mjs", "alice", "--dir", dir);
    assert.equal(a.status, 0, a.stderr);
    const file = path.join(dir, ".env.local"), text = readFileSync(file, "utf8");
    const token = /^TEND_ADMIN_TOKEN=(\S+)$/m.exec(text)![1];
    assert.ok(token.length >= 43, "32 random bytes, base64url");
    assert.ok(!a.stdout.includes(token) && !a.stderr.includes(token), "the token is not printed");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    for (const line of ["TEND_PUBLIC=0", "TEND_DEMO=0", "TEND_LOCAL_HTTP=1"]) assert.ok(text.includes(line), line);
    assert.ok(!/DATABASE_URL|API_KEY/.test(text), "no database address and no provider key");
    const again = run("tester-init.mjs", "alice", "--dir", dir);
    assert.equal(again.status, 1);
    assert.equal(readFileSync(file, "utf8"), text, "the existing file is untouched");
    assert.equal(run("tester-init.mjs", "Bad Name!", "--dir", dir).status, 2);
    const other = mkdtempSync(path.join(tmpdir(), "tend-init-"));
    try {
      run("tester-init.mjs", "bob", "--dir", other);
      assert.notEqual(/^TEND_ADMIN_TOKEN=(\S+)$/m.exec(readFileSync(path.join(other, ".env.local"), "utf8"))![1], token, "every tester gets a different token");
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the tester export drops internal files and the scan finds keys, remote database passwords and personal data", () => {
  const out = exported([".github/workflows/ci.yml", "docs/yc-diligence-report.md", "docs/vercel-hobby-support-email.md", "docs/security-risk-register.md", "docs/real-agent-integrations.md", "docs/images/a.png", "README.md", "docs/connect.md", "src/app/page.tsx"]);
  assert.deepEqual(out, ["docs/connect.md", "src/app/page.tsx"]);
  assert.deepEqual(scan("sk-ant-" + "a".repeat(30)), ["an Anthropic or OpenAI key"]);
  assert.deepEqual(scan("tend_sk_" + "B".repeat(43)), ["a TEND agent key"]);
  assert.deepEqual(scan("postgresql://owner:" + "hunter2pass@ep-x-pooler.eu-central-1.aws.neon.tech/db"), ["a database URL with a password and a remote host"]);
  assert.deepEqual(scan("-----BEGIN " + "PRIVATE KEY-----"), ["a private key"]);
  assert.deepEqual(scan("me@" + "gmail.com"), ["a personal e-mail address"]);
  assert.deepEqual(scan("/Users/" + "someone/project"), ["a local home path"]);
  for (const ok of ["postgres://u:p@localhost:5432/x", "postgres://nobody:nopass@127.0.0.1:1/none", "tend_sk_" + "F".repeat(32), "user@example.com"]) assert.deepEqual(scan(ok), [], ok);
});

const inGit = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repo, encoding: "utf8" }).stdout.trim() === "true";
test("everything the export would publish from this repository is clean", { skip: inGit ? false : "not a git checkout (a downloaded copy): nothing to export" }, () => {
  const files = exported(execFileSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8" }).split("\0").filter(Boolean));
  const bad: string[] = [];
  for (const f of files) {
    if (/\.(png|jpe?g|gif|webp|ico|woff2?)$/i.test(f)) continue;
    for (const what of scan(readFileSync(path.join(repo, f), "utf8"))) bad.push(`${f}: ${what}`);
  }
  assert.deepEqual(bad, []);
  assert.ok(files.length > 100 && !files.some((f) => f.startsWith(".github/") || f.includes("yc-diligence") || f.includes("risk-register") || f === "README.md"));
});
