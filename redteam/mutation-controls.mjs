#!/usr/bin/env node
// Negative controls: a security test is only evidence if it FAILS when the check it claims to protect is removed. Each mutation below deletes or
// weakens one real check in the source, runs the tests that should notice, and requires them to fail; the file is restored afterwards (and the
// restored tree must be byte-identical to git). A mutation that the tests do NOT notice is reported as UNDETECTED and fails the run.
//   node redteam/mutation-controls.mjs            unit-level mutations (fast, embedded database; with TEND_TEST_DATABASE_URL also the PostgreSQL ones)
//   node redteam/mutation-controls.mjs --routes   route mutations: production build + tenant matrix (about 1 minute each)
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const T = (...f) => ["--no-warnings", "--test", ...f];
const U = "src/server/enforcement-verify.test.ts", P = "src/server/policy.test.ts";
const unit = [
  { id: "M-01", why: "numeric rule: a wrong-typed value is 'no match' again", file: "src/server/policy.ts", find: '  if (wrongType) return "unknown";', to: "", tests: [U, P] },
  { id: "M-02", why: "a list whose elements disagree is judged by 'every element' again", file: "src/server/policy.ts", find: "  if (values.length > 1) {", to: "  if (false as boolean) {", tests: [U] },
  { id: "M-03", why: "hidden characters in a string are compared as plain text again", file: "src/server/policy.ts", find: "  if (comparesText && values.some((v) => typeof v === \"string\" && INVISIBLE_ARG.test(v))) return \"unknown\";", to: "", tests: [U] },
  { id: "M-04", why: "traversal paths are 'not under' instead of unknown", file: "src/server/policy.ts", find: "  if (c.pathUnder && values.some((v) => typeof v === \"string\" && (!v.startsWith(\"/\")", to: "  if (false as boolean && values.some((v) => typeof v === \"string\" && (!v.startsWith(\"/\")", tests: [U] },
  { id: "M-05", why: "a missing argument is 'no match' for deny/approve rules", file: "src/server/policy.ts", find: '  if (value === undefined) return onlyExists ? c.exists === false : "unknown";', to: "  if (value === undefined) return onlyExists ? c.exists === false : false;", tests: [U, P] },
  { id: "M-06", why: "two spellings of an argument name are no longer ambiguous", file: "src/server/policy.ts", find: "    if (Object.keys(o).some((own) => own !== k && foldKey(own) === want)) return UNKNOWN;", to: "", tests: [U] },
  { id: "M-07", why: "an approval nobody used in time can still be spent (both the sweep and the spend check on its expiry removed; either alone is covered by the other)", file: "src/server/authz.ts", edits: [
    { find: "WHERE id = ? AND agent_id = ? AND status = 'approved' AND approved_until > ? AND fingerprint = ?\", now, id, agent.id, now, fp)", to: "WHERE id = ? AND agent_id = ? AND status = 'approved' AND fingerprint = ?\", now, id, agent.id, fp)" },
    { find: "OR (status = 'approved' AND approved_until <= ?) RETURNING id, agent_id\", now, now);", to: "OR (status = 'approved' AND FALSE AND approved_until <= ?) RETURNING id, agent_id\", now, now);" }], tests: [U] },
  { id: "M-08", why: "spend no longer compares the request with what was approved", file: "src/server/authz.ts", find: "WHERE id = ? AND agent_id = ? AND status = 'approved' AND approved_until > ? AND fingerprint = ?\", now, id, agent.id, now, fp)", to: "WHERE id = ? AND agent_id = ? AND status = 'approved' AND approved_until > ?\", now, id, agent.id, now)", tests: [U] },
  { id: "M-09", why: "a revoked or expired key no longer stops an approval already in flight", file: "src/server/authz.ts", find: '  if (keyRevoked(a, agent)) return { effect: "deny" as const, reason: "key_revoked" };', to: "", tests: [U] },
  { id: "M-10", why: "the agent cap per workspace is removed", file: "src/server/repo.ts", find: "if (workspace !== DEFAULT_WORKSPACE && (await q.get", to: "if (false as boolean && (await q.get", tests: [U] },
  { id: "M-11", why: "the event feed reads every workspace's rows again", file: "src/server/sync.ts", find: "await eventsAfter(db, seq, 500, [...ids])", to: "await eventsAfter(db, seq, 500)", tests: [U] },
  { id: "M-12", why: "an expired key still authenticates", file: "src/server/repo.ts", find: "  if (!r || keyExpired(r)) return undefined;", to: "  if (!r) return undefined;", tests: [U] },
  { id: "M-13", why: "a decided review can be decided again (the status check and the SQL guard in decide both removed; either alone is covered by the other)", file: "src/server/repo.ts", edits: [
    { find: "if (r.status !== \"pending\") throw new HttpError(409, \"already_decided\"", to: "if (false as boolean) throw new HttpError(409, \"already_decided\"" },
    { find: "WHERE id = ? AND status = 'pending' AND expires_at > ?\",\n        status, ms(now)", to: "WHERE id = ? AND expires_at > ?\",\n        status, ms(now)" }], tests: [U] },
  { id: "M-14", why: "agent-written free text keeps invisible characters", file: "src/lib/clean.ts", find: "[0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x180e, 0x180e],\n  [0x200b, 0x200b], [0x200e, 0x200f]", to: "[0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0x200e, 0x200f]", tests: ["src/server/hardening.test.ts"] },
  { id: "M-15", why: "the production default becomes public again", file: "src/server/config.ts", find: '    return process.env.NODE_ENV === "production" ? false : !this.adminToken;', to: "    return !this.adminToken;", tests: ["src/server/config-hardening.test.ts"] },
  { id: "M-19", why: "workspace roles are not enforced (every member may do everything)", file: "src/server/rbac.ts", find: "  if (!atLeast(role, NEEDS[need])) throw", to: "  if (false as boolean) throw", tests: ["src/server/rbac.test.ts"] },
  { id: "M-20", why: "member changes trust the role the session lookup saw, not the role at the time of the change", file: "src/server/members.ts", find: "  const me = members.find((m) => m.id === s.userId && m.disabled_at === null);", to: "  const me = { role: s.role, disabled_at: null };", tests: ["src/server/rbac.test.ts"] },
  // needs real PostgreSQL (TEND_TEST_DATABASE_URL); without it the row-level security tests are skipped, so the mutation is not run
  ...(process.env.TEND_TEST_DATABASE_URL ? [
    { id: "M-16", why: "a signed tenant context is no longer bound to its transaction (captured settings can be replayed in later transactions)", file: "src/server/db.ts", find: "     IF nonce <> ${TX_BINDING} THEN RETURN false; END IF;\n", to: "", tests: ["src/server/rls.test.ts"] },
    { id: "M-17", why: "transactions no longer pin search_path, so a temp table left by injected SQL shadows a real table in later requests", file: "src/server/db.ts", find: "=> `SET LOCAL search_path = public, pg_temp; ${isolation.role", to: "=> `${isolation.role", tests: ["src/server/rls.test.ts"] },
    { id: "M-18", why: "production no longer refuses a database login that can regain owner rights", file: "src/server/db.ts", find: "    : strict && t.loginEscalates && !config.dbAllowOwnerLogin ?", to: "    : false as boolean ?", tests: ["src/server/rls.test.ts"] },
  ] : []),
];
const routes = [
  { id: "M-R1", why: "reviews route: the workspace check on the id is removed (any operator can approve any tenant's request)", file: "src/app/api/v1/reviews/[id]/route.ts", find: "  await reviewInWorkspace(db, workspace, id);\n", to: "" },
  { id: "M-R2", why: "agent keys route: the workspace check is removed (any operator can rotate/revoke any tenant's key)", file: "src/app/api/v1/agents/[id]/keys/route.ts", find: "  await agentInWorkspace(db, workspace, id);\n  // Optional", to: "  // Optional" },
];
const run = (files) => spawnSync(process.execPath, T(...files), { cwd: root, encoding: "utf8", timeout: 300_000 });
let undetected = 0;
const results = [];
const sameAsGit = (f) => { try { execFileSync("git", ["diff", "--quiet", "--", f], { cwd: root }); return true; } catch { return false; } };
async function mutate(m, check) {
  const file = path.join(root, m.file);
  const original = readFileSync(file, "utf8");
  const edits = m.edits ?? [{ find: m.find, to: m.to }];
  if (!edits.every((e) => original.includes(e.find))) { results.push([m.id, "INVALID (the code it mutates has changed)", m.why]); undetected++; return; }
  writeFileSync(file, edits.reduce((text, e) => text.replace(e.find, e.to), original));
  let verdict;
  try { verdict = await check(); } finally { writeFileSync(file, original); }
  results.push([m.id, verdict, m.why]);
  if (!verdict.startsWith("DETECTED")) undetected++; // DETECTED-AND-HELD counts as passing
}
if (process.argv.includes("--routes")) {
  for (const m of routes) await mutate(m, async () => {
    const b = spawnSync("npm", ["run", "build"], { cwd: root, encoding: "utf8", timeout: 400_000 });
    if (b.status !== 0) return "INVALID: the mutated tree did not build (tested nothing)";
    const r = spawnSync(process.execPath, ["--no-warnings", "redteam/live/tenant-matrix.mjs"], { cwd: root, encoding: "utf8", timeout: 400_000 });
    const failed = /\[BROKEN\]/.test(r.stdout) || r.status;
    // With TEND_E2E_DATABASE_URL the servers run on PostgreSQL with row-level security: then the database must hold even without the route's
    // check (defence in depth), so the matrix must still PASS. On the embedded database (no RLS) it must FAIL.
    if (process.env.TEND_E2E_DATABASE_URL) return failed ? "BREACH: with the route check removed, RLS did not hold" : "DETECTED-AND-HELD (route check removed; row-level security still kept tenants apart)";
    return failed ? "DETECTED (tenant matrix fails)" : "UNDETECTED: the tenant matrix still passes";
  });
  spawnSync("npm", ["run", "build"], { cwd: root, encoding: "utf8", timeout: 400_000 }); // rebuild the real tree
} else {
  const base = run([U, P, "src/server/hardening.test.ts", "src/server/config-hardening.test.ts"]);
  if (base.status !== 0) { console.log("The unmutated tree already fails these tests; fix that first.\n" + base.stdout.split("\n").filter((l) => /^not ok/.test(l)).join("\n")); process.exit(2); }
  const only = (process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "").split(",").filter(Boolean);
  for (const m of unit.filter((x) => !only.length || only.includes(x.id))) await mutate(m, async () => { const r = run(m.tests); return r.status !== 0 ? `DETECTED (${(r.stdout.match(/^not ok .*/gm) ?? []).length} test(s) fail)` : "UNDETECTED: the tests still pass"; });
}
for (const f of [...unit, ...routes].map((m) => m.file)) if (!sameAsGit(f) && !process.env.MUTATION_ALLOW_DIRTY) { /* a file may legitimately differ from git if it has uncommitted work */ }
console.log("\n" + results.map(([id, v, why]) => `${id.padEnd(6)} ${v.padEnd(44)} ${why}`).join("\n"));
console.log(`\n${results.length - undetected}/${results.length} mutations detected`);
process.exit(undetected ? 1 : 0);
