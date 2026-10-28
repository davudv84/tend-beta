import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

/** The production build the isolated server runs. First run only. */
export async function ensureBuilt() {
  if (existsSync(path.join(root, ".next/BUILD_ID"))) return;
  const next = path.join(root, "node_modules/next/dist/bin/next");
  if (!existsSync(next)) throw new Error("The dependencies are not installed yet. Run:  npm ci   and then  npm run demo");
  console.log("Preparing TEND (a one-time build, about 15 seconds) ...");
  let log = "";
  const code = await new Promise((r) => { const c = spawn(process.execPath, [next, "build"], { cwd: root, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } }); c.stdout.on("data", (d) => (log += d)); c.stderr.on("data", (d) => (log += d)); c.on("close", r); });
  if (code !== 0) throw new Error(`The one-time build failed. The last lines:\n${log.split("\n").slice(-12).join("\n")}\nFix that (often a missing "npm ci"), then run this again.`);
}

