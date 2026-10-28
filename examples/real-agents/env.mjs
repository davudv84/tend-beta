// Where an agent process gets its configuration. Never prints a value.
//
//   process environment  >  .env.agent
//
// An agent process never opens .env.local: that file holds the TEND server's TEND_ADMIN_TOKEN (and possibly the database URL and the
// sandbox location), and a process that never reads it cannot leak it or be tricked into using it. So put the provider keys in
// .env.agent, next to the agent keys `npm run agents:setup` writes there. Git-ignored, mode 600.
// TEND_AGENT_ENV_FILE=<path> uses another file for one run; TEND_AGENT_ENV_FILE= (empty) uses none.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const read = (file) => {
  try {
    return parseEnv(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
};

/**
 * `TEND_AGENT_ENV_FILE` replaces .env.agent for one run (an empty value means "no file"). `agents:try` uses it so that a throwaway
 * test run can never pick up the keys `agents:setup` saved for your real TEND server (or your real provider keys).
 */
const agentFile = (root) => (process.env.TEND_AGENT_ENV_FILE !== undefined ? process.env.TEND_AGENT_ENV_FILE : path.join(root, ".env.agent"));

/** Where each setting came from, so a stale shell variable shadowing the file can be seen instead of guessed at. */
export function loadAgentEnvDetailed(root = path.resolve(import.meta.dirname, "../..")) {
  const f = agentFile(root);
  const fromFile = f ? read(f) : {};
  const fromShell = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v));
  return { env: { ...fromFile, ...fromShell }, fromFile, fromShell };
}

/** Always the repository's .env.agent, wherever the agent is started from. */
export function loadAgentEnv(root = path.resolve(import.meta.dirname, "../..")) {
  return loadAgentEnvDetailed(root).env;
}

const KEY_VARS = { openai: "TEND_OPENAI_AGENT_KEY", anthropic: "TEND_ANTHROPIC_AGENT_KEY" };
export const keyVar = (provider) => KEY_VARS[provider];

/** "tend_sk_AbC123": the same prefix the dashboard shows for the key, enough to tell keys apart, not enough to use one. */
export const keyPrefix = (key) => `${String(key).slice(0, 14)}…`;

/**
 * The one place that decides which TEND agent key and address an agent uses (the agents and `agents:setup --check` both call it).
 * The provider's own variable wins over the generic TEND_AGENT_KEY; the shell wins over .env.agent. `warnings` names every case where a
 * shell variable silently replaces what `agents:setup` saved, which is the usual way an agent ends up with a key TEND no longer accepts.
 */
export function resolveAgent({ env, fromFile, fromShell }, provider) {
  const name = KEY_VARS[provider];
  const used = env[name] ? name : env.TEND_AGENT_KEY ? "TEND_AGENT_KEY" : undefined;
  const source = !used ? undefined : fromShell[used] ? "your shell environment" : ".env.agent";
  const url = env.TEND_URL ?? "http://localhost:3000";
  const warnings = [];
  if (used && fromShell[used] && fromFile[used] && fromShell[used] !== fromFile[used]) warnings.push(`${used} in your shell is different from the one in .env.agent and replaces it. If TEND rejects it, \`unset ${used}\`.`);
  if (used === "TEND_AGENT_KEY" && fromFile[name] === undefined && fromFile.TEND_AGENT_KEY === undefined) warnings.push(`Using TEND_AGENT_KEY from your shell; \`npm run agents:setup\` writes ${name} to .env.agent.`);
  if (source === ".env.agent" && fromShell.TEND_URL && fromFile.TEND_URL && fromShell.TEND_URL !== fromFile.TEND_URL) warnings.push(`TEND_URL in your shell (${fromShell.TEND_URL}) differs from the server the keys in .env.agent were issued by (${fromFile.TEND_URL}). A key only works on the TEND that issued it.`);
  return { key: used ? env[used] : undefined, variable: used, source, url, warnings };
}

/** What to tell a person whose key TEND refused. Never contains the key itself. */
export function explainRejectedKey({ key, source, url }, provider) {
  return `TEND at ${url} rejected this agent's key (401 invalid_key). Key ${keyPrefix(key)} came from ${source}. A key stops working when it was rotated or revoked (\`agents:setup --rotate\` and the dashboard's Rotate and Revoke do that), or when it was issued by a different TEND server or database than ${url} (compare the prefix with Settings in the dashboard). Check it with \`npm run agents:setup -- --check\`; if it is dead, \`npm run agents:setup -- ${provider} --rotate\` issues a new one.`;
}

/** A clear message for a missing setting, naming the variable and how to set it (never a value). */
export function need(env, names, hint) {
  const missing = names.filter((n) => !env[n]);
  if (missing.length === 0) return;
  console.error(`Missing ${missing.join(", ")}. ${hint}`);
  process.exit(2);
}
