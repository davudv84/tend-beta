#!/usr/bin/env node
// Installs what npm run verify:integrations needs for the framework integrations, outside the app's own dependencies:
//   scripts/verify/frameworks/node_modules   LangChain, LangGraph, Mastra (npm ci --ignore-scripts: no install scripts run)
//   .verify/py-<framework>/                  PydanticAI, AutoGen, CrewAI, one Python environment each (their pins conflict)
// Python packages: wheels only (no package code runs at install time), and every package, dependencies included, from releases published
// before EXCLUDE_NEWER, so nothing brand new is pulled in. Needs uv (https://docs.astral.sh/uv/); uv fetches CPython 3.13 if it is missing.
//   npm run verify:setup                    everything
//   npm run verify:setup -- js | python     one half
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const EXCLUDE_NEWER = "2026-10-15";
const PYTHON = {
  pydantic_ai: ["pydantic-ai-slim[anthropic]==2.56.0"],
  autogen: ["autogen-agentchat==0.7.5", "autogen-ext[anthropic]==0.7.5", "tiktoken==0.12.0", "anthropic==0.69.0"], // its Anthropic client imports tiktoken without declaring it, and passes arguments newer SDKs refuse
  crewai: ["crewai[anthropic]==1.15.28"],
};
const what = process.argv[2] ?? "all";
const run = (cmd, args, cwd = root) => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) { console.error(`failed: ${cmd} (${r.error?.code ?? r.status})`); process.exit(1); }
};

if (what === "all" || what === "js") run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], path.join(root, "scripts/verify/frameworks"));
if (what === "all" || what === "python") {
  if (spawnSync("uv", ["--version"]).status !== 0) { console.error("uv is not installed: https://docs.astral.sh/uv/getting-started/installation/"); process.exit(1); }
  for (const [name, pkgs] of Object.entries(PYTHON)) {
    const venv = path.join(root, `.verify/py-${name}`);
    run("uv", ["venv", "--quiet", "--allow-existing", "--python", "3.13", venv]);
    run("uv", ["pip", "install", "--quiet", "--python", path.join(venv, "bin/python"), "--only-binary", ":all:", "--exclude-newer", EXCLUDE_NEWER, ...pkgs]);
  }
}
console.log("ready: npm run verify:integrations -- --list");
