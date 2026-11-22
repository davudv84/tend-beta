#!/usr/bin/env node
// Runs the unit and integration suite exactly as `npm test` does (the file list is read from package.json, so the two cannot drift apart) and
// fails unless every test really ran and passed:
//   - any failed or cancelled test fails;
//   - a skipped test fails unless its reason is allow-listed in ci/test-policy.json (with a written why);
//   - fewer tests than ci/test-policy.json `minTests` fails, so a deleted or no-longer-matched test file cannot pass unnoticed;
//   - with CI set, TEND_TEST_DATABASE_URL must be set: the PostgreSQL tests may not be skipped there.
// Exit 0 only when all of that holds. Used by .github/workflows/security.yml; runs locally the same way:  npm run test:gate
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
// --tap <file> and --policy <file> are for the gate's own tests (scripts/ci/gates.test.mjs): judge a saved run instead of running the suite.
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const policy = JSON.parse(readFileSync(arg("--policy") ?? path.join(root, "ci/test-policy.json"), "utf8"));

if (!arg("--tap") && process.env.CI && !process.env.TEND_TEST_DATABASE_URL) {
  console.error("test-gate: CI is set but TEND_TEST_DATABASE_URL is not. The PostgreSQL tests must run in CI.");
  process.exit(1);
}

// "node --no-warnings --test <files…>": add the TAP reporter right after --test.
const cmd = pkg.scripts.test;
if (!/\bnode\b.*--test\b/.test(cmd)) { console.error(`test-gate: unexpected test script: ${cmd}`); process.exit(1); }
const withTap = cmd.replace(/--test\b/, "--test --test-reporter=tap");

let tap = "", code = 0;
if (arg("--tap")) tap = readFileSync(arg("--tap"), "utf8");
else {
  const child = spawn(withTap, { cwd: root, shell: true, stdio: ["ignore", "pipe", "inherit"], env: process.env });
  child.stdout.on("data", (b) => { tap += b; process.stdout.write(b); });
  code = await new Promise((r) => child.on("close", r));
}

const total = (name) => Number(new RegExp(`^# ${name} (\\d+)$`, "m").exec(tap)?.[1] ?? NaN);
const counts = { tests: total("tests"), pass: total("pass"), fail: total("fail"), cancelled: total("cancelled"), skipped: total("skipped"), todo: total("todo") };
const skips = [...tap.matchAll(/^\s*ok \d+ - (.*?) # SKIP\s*(.*)$/gm)].map((m) => ({ name: m[1], reason: m[2].trim() }));
const allowed = (reason) => policy.allowedSkips.some((a) => reason === a.reason);
const problems = [];
if (Object.values(counts).some(Number.isNaN)) problems.push("could not read the test summary (did the runner crash?)");
if (counts.fail > 0) problems.push(`${counts.fail} failed`);
if (counts.cancelled > 0) problems.push(`${counts.cancelled} cancelled`);
if (counts.todo > 0) problems.push(`${counts.todo} marked todo`);
if (counts.tests < policy.minTests) problems.push(`only ${counts.tests} tests ran; at least ${policy.minTests} are expected (ci/test-policy.json)`);
const bad = skips.filter((s) => !allowed(s.reason));
for (const s of bad) problems.push(`skipped without an allowed reason: "${s.name}" (${s.reason || "no reason given"})`);
if (skips.length !== counts.skipped) problems.push(`summary says ${counts.skipped} skipped but ${skips.length} skip lines were found`);
if (code !== 0 && !problems.length) problems.push(`the test runner exited with ${code}`);

console.log(`\ntest-gate: ${counts.tests} tests, ${counts.pass} passed, ${counts.fail} failed, ${counts.cancelled} cancelled, ${counts.skipped} skipped (${skips.length - bad.length} allowed)`);
if (problems.length) {
  console.error(`test-gate: FAILED\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log("test-gate: OK");
