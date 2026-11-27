// The CI gates must fail when they should. Each case feeds a gate a saved report and checks its exit code, so a gate that passes everything
// (and would let a skipped security test or a new advisory through) fails here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(path.join(tmpdir(), "tend-gates-"));
const file = (name, content) => { const p = path.join(dir, name); writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content)); return p; };
const run = (script, args) => spawnSync(process.execPath, [path.join(import.meta.dirname, script), ...args], { encoding: "utf8", env: { ...process.env, CI: "" } }).status;

const policy = file("policy.json", { minTests: 3, allowedSkips: [{ reason: "needs macOS sandbox-exec", why: "Linux CI" }] });
const tap = (lines, { tests = 3, pass = 3, fail = 0, cancelled = 0, skipped = 0, todo = 0 } = {}) =>
  `TAP version 13\n${lines.join("\n")}\n1..${tests}\n# tests ${tests}\n# suites 0\n# pass ${pass}\n# fail ${fail}\n# cancelled ${cancelled}\n# skipped ${skipped}\n# todo ${todo}\n# duration_ms 1\n`;
const gate = (t, extra = []) => run("test-gate.mjs", ["--tap", file(`run-${Math.random()}.tap`, t), "--policy", policy, ...extra]);

test("test gate: passes a clean run, and a skip whose reason is allow-listed", () => {
  assert.equal(gate(tap(["ok 1 - a", "ok 2 - b", "ok 3 - c"])), 0);
  assert.equal(gate(tap(["ok 1 - a", "ok 2 - b", "ok 3 - c # SKIP needs macOS sandbox-exec"], { pass: 2, skipped: 1 })), 0);
});

test("test gate: fails on an unlisted skip, a failure, a cancellation, a todo, too few tests, or an unreadable summary", () => {
  assert.equal(gate(tap(["ok 1 - a", "ok 2 - b", "ok 3 - tenant isolation on PostgreSQL # SKIP set TEND_TEST_DATABASE_URL"], { pass: 2, skipped: 1 })), 1, "a skipped PostgreSQL test");
  assert.equal(gate(tap(["ok 1 - a", "ok 2 - b", "not ok 3 - c"], { pass: 2, fail: 1 })), 1, "a failure");
  assert.equal(gate(tap(["ok 1 - a", "ok 2 - b", "not ok 3 - c"], { pass: 2, cancelled: 1 })), 1, "a cancellation");
  assert.equal(gate(tap(["ok 1 - a", "ok 2 - b", "ok 3 - c # TODO later"], { pass: 2, todo: 1 })), 1, "a todo");
  assert.equal(gate(tap(["ok 1 - a", "ok 2 - b"], { tests: 2, pass: 2 })), 1, "fewer tests than the floor");
  assert.equal(gate("TAP version 13\nnot a summary\n"), 1, "no summary");
});

const advisory = { vulnerabilities: { pkg: { via: [{ url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", severity: "moderate", title: "t", source: 1 }] } }, metadata: { vulnerabilities: { moderate: 1 }, dependencies: { total: 1 } } };
const audit = (report, allow, today = "2026-11-22") => run("audit-gate.mjs", ["--report", file(`r-${Math.random()}.json`, report), "--allowlist", file(`a-${Math.random()}.json`, { advisories: allow }), "--today", today]);

test("audit gate: no advisories passes; any advisory not allow-listed fails, whatever its severity", () => {
  assert.equal(audit({ vulnerabilities: {}, metadata: { vulnerabilities: {} } }, []), 0);
  assert.equal(audit(advisory, []), 1);
  const low = structuredClone(advisory); low.vulnerabilities.pkg.via[0].severity = "low";
  assert.equal(audit(low, []), 1, "even a low one");
});

test("audit gate: an allow-listed advisory passes until its entry expires, and an entry needs a reason", () => {
  const entry = { id: "GHSA-aaaa-bbbb-cccc", package: "pkg", why: "not reachable", expires: "2027-01-31" };
  assert.equal(audit(advisory, [entry]), 0);
  assert.equal(audit(advisory, [entry], "2027-02-01"), 1, "expired");
  assert.equal(audit(advisory, [{ ...entry, why: "" }]), 1, "no reason");
  assert.equal(audit("not json", []), 1, "an audit that did not run fails closed");
});

test("test gate: a database skip passes only with --allow-db-skip (the unit job), never otherwise; other skips still fail with it", () => {
  const dbSkip = tap(["ok 1 - a", "ok 2 - b", "ok 3 - rls # SKIP set TEND_TEST_DATABASE_URL (or run `npm run test:postgres`)"], { pass: 2, skipped: 1 });
  assert.equal(gate(dbSkip), 1);
  assert.equal(gate(dbSkip, ["--allow-db-skip"]), 0);
  assert.equal(gate(tap(["ok 1 - a", "ok 2 - b", "ok 3 - c # SKIP flaky"], { pass: 2, skipped: 1 }), ["--allow-db-skip"]), 1);
});
