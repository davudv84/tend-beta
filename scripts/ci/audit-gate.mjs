#!/usr/bin/env node
// Dependency vulnerability gate. Runs `npm audit` against the lockfile and fails on ANY advisory (every severity) that is not in
// ci/audit-allowlist.json, or whose allow-list entry has expired. A stale entry (the advisory is gone) is reported so it can be removed.
// Network access to the npm registry is required; if the audit itself cannot run, this fails rather than passing blind.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
// --report <file> and --allowlist <file> are for the gate's own tests (scripts/ci/gates.test.mjs).
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const allow = JSON.parse(readFileSync(arg("--allowlist") ?? path.join(root, "ci/audit-allowlist.json"), "utf8")).advisories;
const today = arg("--today") ?? new Date().toISOString().slice(0, 10);
let out;
if (arg("--report")) out = readFileSync(arg("--report"), "utf8");
else try {
  out = execFileSync("npm", ["audit", "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 << 20 });
} catch (e) {
  out = e.stdout; // npm audit exits 1 when it finds something; the JSON is still on stdout
}
let report;
try { report = JSON.parse(out); } catch { console.error("audit-gate: npm audit did not return a report (registry unreachable?). Failing closed."); process.exit(1); }
if (report.error) { console.error(`audit-gate: npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}. Failing closed.`); process.exit(1); }

const found = new Map(); // GHSA id → { severity, packages, title }
for (const [pkg, v] of Object.entries(report.vulnerabilities ?? {}))
  for (const via of v.via) if (typeof via === "object") {
    const id = /GHSA-[\w-]+/.exec(via.url ?? "")?.[0] ?? `npm-${via.source}`;
    const f = found.get(id) ?? { severity: via.severity, title: via.title, packages: new Set() };
    f.packages.add(pkg);
    found.set(id, f);
  }

const problems = [];
for (const [id, f] of found) {
  const entry = allow.find((a) => a.id === id);
  const where = `${id} (${f.severity}) in ${[...f.packages].join(", ")}: ${f.title}`;
  if (!entry) problems.push(`not allow-listed: ${where}`);
  else if (!entry.why || !entry.expires) problems.push(`allow-list entry for ${id} needs "why" and "expires"`);
  else if (entry.expires < today) problems.push(`allow-list entry expired on ${entry.expires}: ${where}`);
  else console.log(`allowed until ${entry.expires}: ${where} (${entry.why})`);
}
for (const a of allow) if (!found.has(a.id)) console.log(`note: ${a.id} is allow-listed but no longer reported; remove it from ci/audit-allowlist.json`);

const m = report.metadata?.vulnerabilities ?? {};
console.log(`audit-gate: ${found.size} advisories (critical ${m.critical ?? 0}, high ${m.high ?? 0}, moderate ${m.moderate ?? 0}, low ${m.low ?? 0}) across ${report.metadata?.dependencies?.total ?? "?"} dependencies`);
if (problems.length) { console.error(`audit-gate: FAILED\n  - ${problems.join("\n  - ")}`); process.exit(1); }
console.log("audit-gate: OK");
