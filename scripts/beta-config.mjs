// Per-tester beta configuration for Vercel + Neon: generate it, and check it. Nothing here talks to Vercel or Neon or creates anything.
//
//   npm run beta:provision -- alice bob carol      writes beta-envs/<name>/vercel.env (mode 600) with a fresh admin token each; prints names only
//   npm run beta:check                             checks every beta-envs/*/vercel.env against the isolation rules below
//
// Isolation rules (each instance is a separate Vercel project with its own Neon project):
//   - its own admin token, strong (src/server/config.ts adminTokenProblem) and different from every other instance's;
//   - its own DATABASE_URL: a Neon pooled connection (host contains "-pooler"), sslmode=require, never localhost, different host AND database from every other;
//   - TEND_PUBLIC=0 and TEND_DEMO=0 (private, no simulated agents); no TEND_LOCAL_HTTP (that is for local servers only); no other TEND_ADMIN_* reuse;
//   - no values shared between instances at all (tokens, payment keys, bypass secrets).
// The folder beta-envs/ is git-ignored. Secrets live only in those files (and then in the Vercel project settings); nothing is printed.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as nodeUtil from "node:util";
const parseEnv = (text) => nodeUtil.parseEnv(text); // a namespace import: a named one would crash at load time on an old Node, before the version check can explain it
import { adminTokenProblem } from "../src/server/config.ts";

const NAME = /^[a-z0-9][a-z0-9-]{0,30}$/;

export function newConfig() {
  return {
    TEND_ADMIN_TOKEN: randomBytes(32).toString("base64url"),
    TEND_PUBLIC: "0",
    TEND_DEMO: "0",
    DATABASE_URL: "", // paste this tester's Neon POOLED connection string here
    TEND_GATEWAY_PAYMENTS_KEY: randomBytes(24).toString("base64url"), // the fake payments tool's key; distinct per instance
    // E-mail accounts (sign-up, verification, reset, approval). All three or none: without them only the admin token can sign in.
    RESEND_API_KEY: "", // from resend.com, for a domain verified there
    TEND_EMAIL_FROM: "", // e.g. TEND <beta@your-domain.com>, on that verified domain
    TEND_APP_URL: "", // the instance's public https address, e.g. https://tend-beta.vercel.app
    TEND_ADMIN_EMAIL: "", // optional: who is mailed when someone waits for approval
  };
}

const render = (c, name) => `# Beta instance "${name}". Secrets: paste into this tester's Vercel project (Production), then keep this file private. Git-ignored.\n${Object.entries(c).map(([k, v]) => `${k}=${v}`).join("\n")}\n`;

export function provision(root, names) {
  const dir = path.join(root, "beta-envs");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const made = [];
  for (const name of names) {
    if (!NAME.test(name)) throw new Error(`"${name}" is not a usable instance name (lowercase letters, digits and hyphens).`);
    const d = path.join(dir, name);
    if (existsSync(path.join(d, "vercel.env"))) throw new Error(`${name} already has a vercel.env; refusing to overwrite its secrets. Delete the folder first if you mean to start over.`);
    mkdirSync(d, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(d, "vercel.env"), render(newConfig(), name), { mode: 0o600 });
    chmodSync(path.join(d, "vercel.env"), 0o600);
    made.push(name);
  }
  return made;
}

/** @returns {{ instance: string, level: "fail" | "warn" | "ok", text: string }[]} */
export function check(instances) {
  const out = [];
  const add = (instance, level, text) => out.push({ instance, level, text });
  const seen = { token: new Map(), host: new Map(), db: new Map(), payments: new Map(), bypass: new Map() };
  const dup = (kind, instance, value, label) => {
    if (!value) return;
    const other = seen[kind].get(value);
    if (other) add(instance, "fail", `${label} is the same as ${other}'s: instances must share nothing.`);
    else seen[kind].set(value, instance);
  };
  for (const [name, env] of Object.entries(instances)) {
    const tok = env.TEND_ADMIN_TOKEN ?? "";
    const problem = tok ? adminTokenProblem(tok, true) : "missing";
    if (problem) add(name, "fail", `TEND_ADMIN_TOKEN is ${problem}.`);
    else add(name, "ok", "admin token is strong.");
    dup("token", name, tok, "TEND_ADMIN_TOKEN");
    dup("payments", name, env.TEND_GATEWAY_PAYMENTS_KEY, "TEND_GATEWAY_PAYMENTS_KEY");
    dup("bypass", name, env.TEND_PROTECTION_BYPASS, "TEND_PROTECTION_BYPASS");

    const url = env.DATABASE_URL ?? "";
    if (!url) add(name, "fail", "DATABASE_URL is empty: paste this tester's Neon pooled connection string.");
    else {
      let u;
      try {
        u = new URL(url);
      } catch {
        add(name, "fail", "DATABASE_URL is not a valid URL.");
      }
      if (u) {
        if (!/^postgres(ql)?:$/.test(u.protocol)) add(name, "fail", "DATABASE_URL is not a postgres:// URL.");
        if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname)) add(name, "fail", "DATABASE_URL points at this machine; a hosted instance needs its own Neon database.");
        if (!u.hostname.includes("-pooler")) add(name, "warn", "DATABASE_URL does not use Neon's pooled host (\"-pooler\"); serverless functions can exhaust direct connections.");
        if (u.searchParams.get("sslmode") !== "require" && !/verify-(ca|full)/.test(u.searchParams.get("sslmode") ?? "")) add(name, "fail", "DATABASE_URL must say sslmode=require.");
        if (!u.password) add(name, "fail", "DATABASE_URL has no password.");
        dup("host", name, u.hostname, "the database host");
        dup("db", name, `${u.hostname}/${u.pathname}`, "the database");
      }
    }
    const mail = ["RESEND_API_KEY", "TEND_EMAIL_FROM", "TEND_APP_URL"].filter((k) => env[k]);
    if (!mail.length) add(name, "ok", "accounts are off (no mail settings): only the admin token can sign in.");
    else if (mail.length < 3) add(name, "fail", `e-mail accounts need RESEND_API_KEY, TEND_EMAIL_FROM and TEND_APP_URL together; missing ${["RESEND_API_KEY", "TEND_EMAIL_FROM", "TEND_APP_URL"].filter((k) => !env[k]).join(", ")}.`);
    else {
      if (!/^re_[A-Za-z0-9_]{16,}$/.test(env.RESEND_API_KEY)) add(name, "fail", "RESEND_API_KEY does not look like a Resend API key (re_…).");
      if (!/@[^\s@>]+\.[a-z]{2,}>?$/i.test(env.TEND_EMAIL_FROM)) add(name, "fail", "TEND_EMAIL_FROM is not an e-mail address (\"TEND <beta@your-domain.com>\").");
      else if (/@resend\.dev>?$/i.test(env.TEND_EMAIL_FROM)) add(name, "fail", "TEND_EMAIL_FROM uses resend.dev, which only delivers to the Resend account's own address: testers would get no mail. Verify your own domain in Resend.");
      if (!/^https:\/\/[^\s/]+$/.test(env.TEND_APP_URL)) add(name, "fail", "TEND_APP_URL must be the instance's https:// address with no path.");
      if (env.TEND_ADMIN_EMAIL && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(env.TEND_ADMIN_EMAIL)) add(name, "fail", "TEND_ADMIN_EMAIL is not an e-mail address.");
      if (!out.some((r) => r.instance === name && r.level === "fail" && /RESEND|EMAIL|APP_URL/.test(r.text))) add(name, "ok", "e-mail accounts are configured (sign-up, verification, reset and approval mails).");
    }
    if (env.TEND_PUBLIC !== "0") add(name, "fail", "TEND_PUBLIC must be 0: the instance is private.");
    if (env.TEND_DEMO !== "0") add(name, "fail", "TEND_DEMO must be 0: no simulated agents in a beta.");
    for (const forbidden of ["TEND_LOCAL_HTTP", "TEND_TRUSTED_PROXY", "TEND_DATA_DIR", "VERCEL", "NODE_ENV"]) if (env[forbidden] !== undefined) add(name, "fail", `${forbidden} must not be set (Vercel sets what it needs; local-only settings do not belong in a hosted instance).`);
  }
  if (Object.keys(instances).length < 2) add("-", "ok", "one instance: testers are kept apart by their own accounts and workspaces on it.");
  return out;
}

export function loadAll(root) {
  const dir = path.join(root, "beta-envs");
  const instances = {};
  const modes = [];
  if (!existsSync(dir)) return { instances, modes };
  for (const name of readdirSync(dir)) {
    const f = path.join(dir, name, "vercel.env");
    if (!existsSync(f)) continue;
    instances[name] = parseEnv(readFileSync(f, "utf8"));
    modes.push([name, statSync(f).mode & 0o777]);
  }
  return { instances, modes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  const [cmd, ...names] = process.argv.slice(2);
  if (cmd === "provision") {
    if (!names.length) {
      console.error("Usage: npm run beta:provision -- <name> [<name> …]");
      process.exit(2);
    }
    try {
      const made = provision(root, names);
      console.log(`Created beta-envs/${made.join(", beta-envs/")} (each vercel.env is mode 600; fresh admin token and payments key; DATABASE_URL left empty).`);
      console.log("Next: create one Neon project and one Vercel project per name, paste the pooled connection string, then npm run beta:check.");
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  } else if (cmd === "check") {
    const { instances, modes } = loadAll(root);
    if (!Object.keys(instances).length) {
      console.error("No beta-envs/*/vercel.env found. Run: npm run beta:provision -- <names>");
      process.exit(2);
    }
    const results = check(instances);
    for (const [n, m] of modes) if (m & 0o077) results.push({ instance: n, level: "fail", text: `vercel.env is readable by other accounts (mode ${m.toString(8)}); chmod 600.` });
    for (const r of results) console.log(`${r.level === "ok" ? "ok  " : r.level === "warn" ? "WARN" : "FAIL"} [${r.instance}] ${r.text}`);
    const fails = results.filter((r) => r.level === "fail").length;
    console.log(`\n${Object.keys(instances).length} instance(s), ${fails} failing, ${results.filter((r) => r.level === "warn").length} warning(s).`);
    process.exit(fails ? 1 : 0);
  } else {
    console.error("Usage: node scripts/beta-config.mjs provision <names…> | check");
    process.exit(2);
  }
}
