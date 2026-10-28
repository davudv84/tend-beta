// Operator-side helper: where the TEND server keeps its sandbox folder and database folder. Reads TEND_GATEWAY_SANDBOX_DIR and TEND_DATA_DIR
// from the environment or, failing that, from .env.local. Only those two names are looked at, and nothing is printed. Agents never import this.
import { readFileSync } from "node:fs";
import path from "node:path";
import * as nodeUtil from "node:util";
const parseEnv = (text) => nodeUtil.parseEnv(text); // a namespace import: a named one would crash at load time on an old Node, before the version check can explain it

export function serverPaths(root, env = process.env) {
  let local = {};
  try {
    local = parseEnv(readFileSync(path.join(root, ".env.local"), "utf8"));
  } catch {}
  const pick = (name) => {
    const v = env[name] ?? local[name];
    return v ? path.resolve(root, v) : undefined;
  };
  return { sandbox: pick("TEND_GATEWAY_SANDBOX_DIR"), data: pick("TEND_DATA_DIR") };
}
