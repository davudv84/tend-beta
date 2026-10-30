#!/usr/bin/env node
// Builds a clean, single-commit copy of TEND for beta testers in a NEW folder. It never pushes, never talks to GitHub or Vercel.
//
//   npm run tester:export -- --out ../tend-beta
//
// What it does, in order, and stops at the first problem:
//   1. refuses unless the working tree has no uncommitted changes to tracked files (what you export is exactly a commit);
//   2. copies only git-tracked files, minus the internal ones (strategy, hosting and security reports, README, CI workflow);
//   3. adds vercel.json (git.deploymentEnabled: false, so even if this repository is ever imported into Vercel it deploys nothing)
//      and README.md (the tester guide, replacing the product README);
//   4. scans every copied file for keys, private keys, remote database passwords, personal addresses and local paths;
//   5. starts a fresh git history (one commit, authored with this repository's git identity) so no old commit or old author leaks.
// Then it PRINTS the commands to create the private repository and invite testers. It does not run them.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DENY = [
  /^\.github\//,
  /^docs\/(yc-demo|yc-diligence-report|vercel-hobby-support-email|beta-readiness-plan|beta-deployment|beta-local-hosting|overnight-audit|mvp-plan|product-readiness)\.md$/,
  // internal engineering and security reports, the design system, and the product README (its research framing is not what testers install)
  /^docs\/(security-risk-register|security-hardening|real-agent-integrations|design-system|tester-quickstart)\.md$/,
  /^docs\/images\//,
  /^README\.md$/,
];
export const FINDINGS = [
  ["an Anthropic or OpenAI key", /sk-(ant|proj)-[A-Za-z0-9_-]{20,}/],
  ["a TEND agent key", /tend_sk_[A-Za-z0-9_-]{40,}/],
  ["an AWS key", /AKIA[0-9A-Z]{14,}/],
  ["a GitHub token", /gh[pousr]_[A-Za-z0-9]{30,}/],
  ["a private key", /BEGIN [A-Z ]*PRIVATE KEY/],
  ["a database URL with a password and a remote host", /postgres(?:ql)?:\/\/[^:\s'"/]+:[^@\s'"$]+@(?!localhost|127\.0\.0\.1|\[::1\])[^\s'"/$]+/],
  ["a personal e-mail address", /[A-Za-z0-9._%+-]+@(?:gmail|outlook|hotmail|icloud|yahoo)\.com/i],
  ["a local home path", /\/Users\/[a-z]+/], // macOS homes are always /Users/<name>; case-insensitive, it flagged API paths like /api/admin/users/x
];

/** Pure: which tracked paths are exported. */
export const exported = (files) => files.filter((f) => !DENY.some((d) => d.test(f)));
/** Pure: what a file's text contains that must not be published. */
export const scan = (text) => FINDINGS.filter(([, re]) => re.test(text)).map(([what]) => what);

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(import.meta.dirname, "..");
  const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" });
  const die = (m) => {
    console.error(m);
    process.exit(1);
  };
  const o = process.argv.indexOf("--out");
  const out = o > 0 ? path.resolve(process.argv[o + 1] ?? "") : "";
  if (!out || out === root || out.startsWith(root + path.sep)) die("Usage: npm run tester:export -- --out <new folder outside this repository>");
  if (existsSync(out) && readdirSync(out).length) die(`${out} exists and is not empty. Choose a new folder.`);

  if (git(root, "status", "--porcelain", "--untracked-files=no").trim()) die("There are uncommitted changes to tracked files. Commit them first: the export is exactly one commit.");
  const files = exported(git(root, "ls-files", "-z").split("\0").filter(Boolean));
  const name = git(root, "config", "user.name").trim(), email = git(root, "config", "user.email").trim();
  if (!email.endsWith("@users.noreply.github.com")) die(`git user.email is ${email}. Use your GitHub noreply address for the export so no personal address ends up in the history.`);

  const guide = path.join(root, "docs/tester-quickstart.md");
  if (!existsSync(guide)) die("docs/tester-quickstart.md is missing.");
  const extra = { "README.md": readFileSync(guide, "utf8"), "vercel.json": `${JSON.stringify({ $schema: "https://openapi.vercel.sh/vercel.json", git: { deploymentEnabled: false } }, null, 2)}\n` };

  const problems = [];
  for (const f of files) {
    const src = path.join(root, f);
    if (lstatSync(src).isSymbolicLink()) problems.push(`${f}: is a symbolic link`);
    else if (!/\.(png|jpe?g|gif|webp|ico|woff2?)$/i.test(f)) for (const what of scan(readFileSync(src, "utf8"))) problems.push(`${f}: contains ${what}`);
  }
  for (const [f, text] of Object.entries(extra)) for (const what of scan(text)) problems.push(`${f}: contains ${what}`);
  if (problems.length) die(`Nothing was written. Found:\n  ${problems.join("\n  ")}`);

  for (const f of files) {
    mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    copyFileSync(path.join(root, f), path.join(out, f));
  }
  for (const [f, text] of Object.entries(extra)) writeFileSync(path.join(out, f), text);
  git(out, "init", "-q", "-b", "main");
  git(out, "add", "-A");
  git(out, "-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-q", "-m", "TEND beta for testers");

  console.log(`Exported ${files.length + 2} files to ${out} as one commit. Nothing was pushed.\n`);
  console.log("When you approve, create the PRIVATE repository from that folder (these commands are not run for you):\n");
  console.log(`  cd ${out}\n  gh repo create <you>/tend-beta --private --source=. --remote=origin --push\n  gh api -X PUT repos/<you>/tend-beta/collaborators/<tester-github-name> -f permission=pull   # once per tester, read-only\n`);
  console.log("Do not import this repository into Vercel. If you ever do, vercel.json already turns Git deployments off.");
}
