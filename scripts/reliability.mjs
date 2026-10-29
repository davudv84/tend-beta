#!/usr/bin/env node
// The reliability matrix: each required failure case, and the tests that show protected actions fail closed in it. Runs exactly those tests
// (by name) and reports per case; a case passes only if every one of its tests ran and passed. No model, no network, no key.
//
//   npm run reliability                 the table
//   npm run reliability -- --json FILE  also write the results (used by npm run benchmark)
import "./node-check.mjs";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const T = (file, ...names) => ({ file, names });
export const CASES = [
  ["Unauthorized tool execution", [
    T("src/server/authz.test.ts", "in enforce mode, running a policy-governed tool without an authorization is flagged", "mismatched execution: any changed field is refused", "an execution report must match a consumed authorization exactly"),
    T("examples/claude-agent/gate.test.mjs", "denied by policy, or no policy at all: nothing runs", "mismatched execution: if the call differs from what was authorized"),
    T("src/server/mcp-proxy.test.ts", "denied by policy, or no rule at all: the server never sees the call"),
  ]],
  ["Agent revocation", [
    T("src/server/security.test.ts", "a revoked key stops authenticating at once", "revoking cancels what the old key had waiting"),
    T("src/server/central-policy.test.ts", "revoking one agent leaves the other agent"),
    T("src/server/reliability.test.ts", "the key is revoked after the token was claimed but before it is spent"),
    T("src/server/mcp-proxy.test.ts", "revoking the agent's key while a call waits stops it"),
  ]],
  ["Approval replay", [
    T("src/server/authz.test.ts", "replay: a spent token fails", "concurrent consumption: of ten simultaneous attempts exactly one wins"),
    T("src/server/failure-modes.test.ts", "a spent approval cannot be used again"),
    T("examples/claude-agent/gate.test.mjs", "replay: a spent token cannot be used again"),
  ]],
  ["Policy change during a pending approval", [
    T("src/server/central-policy.test.ts", "tightening the central policy while a request waits or is approved stops it"),
    T("src/server/authz.test.ts", "tightening the policy or breaking it takes effect on a token already issued", "tightening allow to approve stops an authorization no person approved"),
    T("src/server/reliability.test.ts", "the agent's own policy is tightened to never while a request waits"),
  ]],
  ["TEND unavailable", [
    T("examples/claude-agent/gate.test.mjs", "fail closed: whenever Tend cannot be reached or answers badly", "a lost consume response is never retried"),
    T("src/server/mcp-proxy.test.ts", "TEND unreachable: the call is refused"),
  ]],
  ["Database unavailable", [
    T("src/server/failure-modes.test.ts", "a database that goes away"),
    T("src/server/security.test.ts", "if the database fails while an approval is being spent", "if the rate-limit store fails, an agent is not let through"),
  ]],
  ["Cross-tenant isolation", [
    T("src/server/tenancy.test.ts", "each account sees only its own workspace", "an id from another workspace is not found", "agent keys are a separate credential", "disabling an account also stops its agents"),
    T("src/server/routes.test.ts", "operator routes stay inside the caller's workspace"),
    T("src/server/authz.test.ts", "an agent can neither see nor use another agent's authorization"),
  ]],
];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function run() {
  return CASES.map(([name, groups]) => {
    let expected = 0, passed = 0, failed = 0;
    for (const g of groups) {
      expected += g.names.length;
      const r = spawnSync(process.execPath, ["--no-warnings", "--test", "--test-reporter=tap", ...g.names.flatMap((n) => ["--test-name-pattern", `^${escape(n)}`]), g.file], { cwd: root, encoding: "utf8", env: { ...process.env, TEND_DEMO: "0" } });
      passed += (r.stdout.match(/^ok \d+ - /gm) ?? []).length;
      failed += (r.stdout.match(/^not ok \d+ - /gm) ?? []).length;
    }
    return { case: name, tests: expected, passed, failed, ok: failed === 0 && passed === expected };
  });
}

if (process.argv[1] === import.meta.filename) {
  const results = run();
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.case.padEnd(42)} ${r.passed}/${r.tests} tests${r.failed ? `, ${r.failed} failed` : ""}`);
  const ok = results.every((r) => r.ok);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} cases fail closed as required${ok ? "" : " (a missing count means a test was renamed or not found)"}`);
  const i = process.argv.indexOf("--json");
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(results, null, 2));
  process.exitCode = ok ? 0 : 1;
}
