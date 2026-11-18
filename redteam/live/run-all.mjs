// Runs the whole live red-team suite against a throwaway local server and fails if anything is BROKEN.
//   npm run build && node redteam/live/run-all.mjs        (CI: .github/workflows/security.yml)
import { spawnSync } from "node:child_process";
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
const run = (file) => {
  console.log(`\n=== ${file}`);
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(here, file)], { env, encoding: "utf8", cwd: root, timeout: 600_000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  process.stdout.write(out.split("\n").filter((l) => /^\[(BROKEN|INCONCLUSIVE)/.test(l) || /Error|error:/.test(l)).slice(0, 40).join("\n") + "\n");
  held += (out.match(/^\[HELD/gm) ?? []).length;
  const b = (out.match(/^\[(BROKEN|INCONCLUSIVE)/gm) ?? []).length;
  broken += b + (r.status ? 1 : 0);
  if (r.status) console.log(`${file} exited ${r.status}`);
};
try {
  // Wait a minute between the scripts that share per-minute budgets? Each uses its own agents; the sign-in flood runs last.
  for (const f of ["setup.mjs", "phase1-policy.mjs", "phase1-approvals.mjs", "phase1-central.mjs", "phase1-gateway.mjs", "phase2-web.mjs"]) run(f);
} finally {
  await server.stop();
}
const fuzz = spawnSync(process.execPath, ["--no-warnings", path.join(here, "fuzz-policy.mjs")], { encoding: "utf8", cwd: root, env: { ...process.env, N: "10000" } });
console.log("\n=== fuzz-policy.mjs\n" + fuzz.stdout);
for (const k of ["summary", "typeNum", "crash", "fp", "monoRule", "list", "hidden"]) if (!new RegExp(`${k}\\s+violations=0`).test(fuzz.stdout)) { console.log(`FUZZ VIOLATION in ${k}`); broken++; }
console.log(`\nHELD=${held} BROKEN/INCONCLUSIVE=${broken}`);
process.exit(broken ? 1 : 0);
