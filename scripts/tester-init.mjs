#!/usr/bin/env node
// Per-tester local configuration. Run once, on the tester's OWN machine:  npm run tester:init -- <your-name>
// Writes .env.local (mode 600, git-ignored) with a fresh random sign-in token that never leaves this machine, a private
// sandbox folder, and nothing else: no database address, no keys. Refuses to overwrite an existing file.
import "./node-check.mjs";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const d = args.indexOf("--dir");
const root = d >= 0 ? path.resolve(args[d + 1]) : path.resolve(import.meta.dirname, "..");
const name = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--dir") ?? "";
if (name && !/^[a-z][a-z0-9-]{0,30}$/.test(name)) {
  console.error("Use a short lowercase name: letters, digits and dashes, starting with a letter (for example: alice).");
  process.exit(2);
}

const file = path.join(root, ".env.local");
const sandbox = path.join(root, ".agent-sandbox");
const lines = [
  `# TEND settings for this machine only${name ? ` (tester: ${name})` : ""}. Git-ignored. Never share this file or paste the token anywhere but the sign-in page.`,
  `TEND_ADMIN_TOKEN=${randomBytes(32).toString("base64url")}`,
  "TEND_PUBLIC=0", // nobody can browse without signing in
  "TEND_DEMO=0", // no simulated agents
  "TEND_LOCAL_HTTP=1", // lets Safari keep the sign-in cookie over http://localhost (loopback only; ignored on any other address)
  `TEND_GATEWAY_SANDBOX_DIR=${sandbox}`,
  "",
];
try {
  writeFileSync(file, lines.join("\n"), { mode: 0o600, flag: "wx" });
} catch (e) {
  if (e.code === "EEXIST") {
    console.error(`${file} already exists, so nothing was changed. Delete it first only if you want a new sign-in token.`);
    process.exit(1);
  }
  throw e;
}
mkdirSync(sandbox, { recursive: true, mode: 0o700 });
console.log(`Created ${file} (mode 600) and the sandbox folder ${sandbox}.\nYour sign-in token is the value after TEND_ADMIN_TOKEN= in that file. It was not printed.`);
