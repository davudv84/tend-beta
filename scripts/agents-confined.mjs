#!/usr/bin/env node
// Runs one of the example agents under operating-system confinement (see scripts/confine.mjs).
//
//   npm run agents:confined -- openai [--task write]       (or anthropic)
//
// The agent's environment is rebuilt from nothing: PATH plus the variables it needs, taken from .env.agent and your shell. It cannot read
// .env.local, the sandbox folder, the database folder, the source tree or your credential folders, and it cannot see other processes.
// This wrapper is operator-side: to know which folders to hide it reads TEND_GATEWAY_SANDBOX_DIR and TEND_DATA_DIR from your
// environment or .env.local (those two names only; nothing is printed).
import path from "node:path";
import { loadAgentEnv } from "../examples/real-agents/env.mjs";
import { canConfine, confinedSpawn } from "./confine.mjs";
import { serverPaths } from "./server-paths.mjs";

const root = path.resolve(import.meta.dirname, "..");
const [provider, ...rest] = process.argv.slice(2);
if (!["openai", "anthropic"].includes(provider)) {
  console.error("Usage: npm run agents:confined -- <openai|anthropic> [--task all|read|write|delete | \"your prompt\"]");
  process.exit(2);
}
if (!canConfine()) {
  console.error("Confinement needs macOS with /usr/bin/sandbox-exec. Refusing to run the agent unconfined. Use a separate OS user or a container, or run `npm run agents:" + provider + "` knowingly without confinement.");
  process.exit(2);
}

const { sandbox, data } = serverPaths(root);
const hidden = [sandbox, data].filter(Boolean);

const fromFile = loadAgentEnv(root);
const KEEP = ["TEND_URL", "TEND_AGENT_KEY", "TEND_OPENAI_AGENT_KEY", "TEND_ANTHROPIC_AGENT_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_MODEL", "CLAUDE_MODEL", "OPENAI_AGENTS_TRACING", "TEND_PROTECTION_BYPASS", "TEND_CF_ACCESS_CLIENT_ID", "TEND_CF_ACCESS_CLIENT_SECRET"];
const env = { PATH: process.env.PATH ?? "", TMPDIR: process.env.TMPDIR ?? "/tmp", LC_ALL: "C", ...Object.fromEntries(KEEP.filter((k) => fromFile[k]).map((k) => [k, fromFile[k]])) };

console.log(`[confined] ${provider} agent: cannot read .env.local, the sandbox or database folders, the source tree or ~/.ssh and friends; cannot see other processes.`);
const child = confinedSpawn([process.execPath, path.join(root, "examples/real-agents", `${provider}-agent.mjs`), ...rest], { root, hidden, env });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
