// Runs the whole live red-team suite against a throwaway local server and fails if anything is BROKEN.
//   npm run build && node redteam/live/run-all.mjs        (CI: .github/workflows/security.yml)
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "../../scripts/isolated-server.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const here = import.meta.dirname;
const work = mkdtempSync(path.join(tmpdir(), "tend-redteam-"));
const notes = path.join(work, "notes"), outside = path.join(work, "outside");
mkdirSync(notes); mkdirSync(outside);
writeFileSync(path.join(outside, "secret.txt"), "TOP-SECRET-OUTSIDE\n");
writeFileSync(path.join(notes, "hello.txt"), "hello note\n");
symlinkSync(path.join(outside, "secret.txt"), path.join(notes, "linked.txt"));
const ADMIN = `rt_admin_${randomBytes(24).toString("hex")}`;
const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: path.join(work, "data"), TEND_GATEWAY_NOTES_DIR: notes, TEND_GATEWAY_PAYMENTS_KEY: `rt_pay_${randomBytes(16).toString("hex")}` } });
const env = { ...process.env, RT_BASE: server.url, RT_DATA: path.join(work, "data"), RT_ADMIN_TOKEN: ADMIN };
let broken = 0, held = 0;
// Asynchronously, not with spawnSync: while a phase runs this process must keep reading the server's stdout/stderr. Node writes to pipes
// synchronously on Linux, so a server whose log pipe is not drained blocks in console.warn once 64 KB are waiting, and its requests hang.
const runAsync = (file) => new Promise((resolve) => {
  const child = spawn(process.execPath, ["--no-warnings", path.join(here, file)], { env, cwd: root });
  let stdout = "", stderr = "";
  child.stdout.on("data", (b) => (stdout += b)); child.stderr.on("data", (b) => (stderr += b));
  const kill = setTimeout(() => child.kill("SIGKILL"), 600_000);
  child.on("close", (status) => { clearTimeout(kill); resolve({ status, stdout, stderr }); });
});
const run = async (file) => {
  console.log(`\n=== ${file}`);
  const r = await runAsync(file);
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  process.stdout.write(out.split("\n").filter((l) => (process.env.RT_VERBOSE && /^\[(HELD|INFO)/.test(l)) || /^\[(BROKEN|INCONCLUSIVE)/.test(l) || /Error|error:/.test(l)).slice(0, process.env.RT_VERBOSE ? Infinity : 40).join("\n") + "\n");
  held += (out.match(/^\[HELD/gm) ?? []).length;
  const b = (out.match(/^\[(BROKEN|INCONCLUSIVE)/gm) ?? []).length;
  broken += b + (r.status ? 1 : 0);
  if (r.status) console.log(`${file} exited ${r.status}`);
};
try {
  // Wait a minute between the scripts that share per-minute budgets? Each uses its own agents; the sign-in flood runs last.
  for (const f of ["setup.mjs", "phase1-policy.mjs", "phase1-approvals.mjs", "phase1-central.mjs", "phase1-gateway.mjs", "phase2-web.mjs"]) await run(f);
} finally {
  if (process.env.RT_SERVER_LOG) writeFileSync(process.env.RT_SERVER_LOG, server.output()); // the server's own output, for debugging a run
  await server.stop();
}
const fuzz = spawnSync(process.execPath, ["--no-warnings", path.join(here, "fuzz-policy.mjs")], { encoding: "utf8", cwd: root, env: { ...process.env, N: "10000" } });
console.log("\n=== fuzz-policy.mjs\n" + fuzz.stdout);
for (const k of ["summary", "typeNum", "crash", "fp", "monoRule", "list", "hidden", "twin"]) if (!new RegExp(`${k}\\s+violations=0`).test(fuzz.stdout)) { console.log(`FUZZ VIOLATION in ${k}`); broken++; }
console.log(`\nHELD=${held} BROKEN/INCONCLUSIVE=${broken}`);
process.exit(broken ? 1 : 0);
