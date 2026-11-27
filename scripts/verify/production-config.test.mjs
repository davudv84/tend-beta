// The production preflight (scripts/check-production-config.mjs): a correct setup passes, each missing requirement blocks, no value is printed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkProductionConfig, explainShape, parseEnvFile } from "../check-production-config.mjs";

// Built at run time with a dummy password: a real deployment's URLs carry one, and no credential-shaped URL sits in a published file.
const pgUrl = (user, host = "db.example.net", db = "tend") => { const u = new URL(`postgres://${host}/${db}?sslmode=require`); u.username = user; u.password = "dummy-not-a-secret"; return u.toString(); };
const good = {
  DATABASE_URL: pgUrl("tend_app"), DATABASE_MIGRATE_URL: pgUrl("owner"),
  TEND_CONTEXT_KEY: "c".repeat(10) + "0123456789abcdefghijklmnopqrstuv", TEND_MFA_KEY: "m".repeat(10) + "0123456789abcdefghijklmnopqrstuv",
  TEND_ADMIN_TOKEN: "a".repeat(4) + "0123456789abcdefghijklmnopqrstuvwxyz", TEND_APP_URL: "https://tend.example.net", TEND_ALERT_WEBHOOK_URL: "https://hooks.example.net/x",
};

test("PROD-1 the production default passes; each missing requirement blocks", () => {
  assert.deepEqual(checkProductionConfig(good), { problems: [], warnings: [] });
  const blocks = (change, re) => assert.ok(checkProductionConfig({ ...good, ...change }).problems.some((p) => re.test(p)), JSON.stringify(change));
  blocks({ DATABASE_MIGRATE_URL: undefined }, /DATABASE_MIGRATE_URL/);
  blocks({ DATABASE_MIGRATE_URL: good.DATABASE_URL }, /different logins/);
  blocks({ TEND_CONTEXT_KEY: "short" }, /TEND_CONTEXT_KEY/);
  blocks({ TEND_DB_ISOLATION: "off" }, /TEND_DB_ISOLATION/);
  blocks({ TEND_DB_STRICT: "0" }, /TEND_DB_STRICT/);
  blocks({ TEND_ADMIN_TOKEN: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, /TEND_ADMIN_TOKEN/);
  blocks({ TEND_APP_URL: "http://tend.example.net" }, /TEND_APP_URL/);
  blocks({ TEND_MFA_KEY: good.TEND_CONTEXT_KEY }, /different secrets/);
  const owner = checkProductionConfig({ ...good, DATABASE_MIGRATE_URL: undefined, TEND_DB_ALLOW_OWNER_LOGIN: "1" });
  assert.equal(owner.problems.length, 0);
  assert.ok(owner.warnings.some((w) => /SQL injection/.test(w)), "the owner-login exception is allowed but always warned about");
});

test("PROD-2 the command line prints no value and exits 1 on a blocking problem", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tend-preflight-"));
  const file = path.join(dir, ".env");
  writeFileSync(file, Object.entries({ ...good, TEND_CONTEXT_KEY: "tooshortsecretvalue" }).map(([k, v]) => `${k}=${v}`).join("\n"));
  let out = "", code = 0;
  try { out = execFileSync(process.execPath, ["scripts/check-production-config.mjs", file], { encoding: "utf8", env: { PATH: process.env.PATH } }); } catch (e) { out = e.stdout; code = e.status; }
  assert.equal(code, 1);
  assert.match(out, /BLOCKING  TEND_CONTEXT_KEY/);
  for (const v of [...Object.values(good), "tooshortsecretvalue"]) assert.ok(!out.includes(v), "no value printed");
});

const cli = (text, ...args) => {
  const dir = mkdtempSync(path.join(tmpdir(), "tend-preflight-"));
  const file = path.join(dir, ".env.preflight");
  writeFileSync(file, text);
  try { return { out: execFileSync(process.execPath, ["scripts/check-production-config.mjs", file, ...args], { encoding: "utf8", env: { PATH: process.env.PATH } }), code: 0 }; } catch (e) { return { out: e.stdout, code: e.status }; }
};
const asFile = (env) => Object.entries(env).map(([k, v]) => `${k}="${v}"`).join("\n");

test("PROD-3 five settings that all hold one identical short value (a placeholder, or values that were not exported) give the seven blocking errors, and the output says so without printing the value", () => {
  const placeholder = "plc0holder1"; // 11 characters, the shape seen on a Vercel Preview pull
  const env = { DATABASE_URL: placeholder, DATABASE_MIGRATE_URL: placeholder, TEND_CONTEXT_KEY: placeholder, TEND_MFA_KEY: placeholder, TEND_ADMIN_TOKEN: placeholder, TEND_APP_URL: good.TEND_APP_URL };
  assert.equal(checkProductionConfig(env).problems.length, 7);
  const { out, code } = cli(asFile(env));
  assert.equal(code, 1);
  assert.match(out, /7 blocking problem/);
  assert.match(out, /hint .*DATABASE_URL, DATABASE_MIGRATE_URL, TEND_CONTEXT_KEY, TEND_MFA_KEY, TEND_ADMIN_TOKEN all hold exactly the same value \(11 characters\)/);
  assert.match(out, /DATABASE_URL is 11 characters and has no postgres:\/\/ scheme/);
  assert.ok(!out.includes(placeholder), "the value is never printed");
});

test("PROD-4 a missing variable and an empty one are told apart, and a file from Windows or with export lines is read correctly", () => {
  assert.deepEqual(explainShape({ DATABASE_URL: "" }).filter((l) => /DATABASE_URL/.test(l)), ["DATABASE_URL is present but empty."]);
  assert.ok(explainShape({}).some((l) => /TEND_ADMIN_TOKEN is not in the file/.test(l)));
  const parsed = parseEnvFile(`export DATABASE_URL="${good.DATABASE_URL}"\r\nTEND_ADMIN_TOKEN='${good.TEND_ADMIN_TOKEN}'\r\n# a comment\r\nTEND_APP_URL=${good.TEND_APP_URL}\r\n`);
  assert.equal(parsed.DATABASE_URL, good.DATABASE_URL);
  assert.equal(parsed.TEND_ADMIN_TOKEN, good.TEND_ADMIN_TOKEN);
  assert.equal(parsed.TEND_APP_URL, good.TEND_APP_URL, "no carriage return left in the value");
  const ok = cli(asFile(good).replace(/\n/g, "\r\n"));
  assert.equal(ok.code, 0, ok.out);
});

test("PROD-5 the two URLs must lead to the same database, and --expect-db / --runtime-user / --migrate-user pin names (names only are printed)", () => {
  // Built at run time: no credential-shaped URL in a file the repository publishes (the export scan and gitleaks would rightly flag one).
  const neon = (user, host) => { const u = new URL(`postgres://${host}.eu.neon.tech/tend_preview_fresh?sslmode=require`); u.username = user; u.password = "pw-not-printed"; return u.toString(); };
  const pooled = neon("tend_runtime_v2", "ep-x-pooler"), direct = neon("neondb_owner", "ep-x");
  const env = { ...good, DATABASE_URL: pooled, DATABASE_MIGRATE_URL: direct };
  assert.deepEqual(checkProductionConfig(env, { db: "tend_preview_fresh", runtimeUser: "tend_runtime_v2", migrateUser: "neondb_owner" }), { problems: [], warnings: [] }, "Neon's pooled and direct hosts of one endpoint are the same");
  const blocks = (e, x, re) => assert.ok(checkProductionConfig(e, x).problems.some((p) => re.test(p)), re.source);
  blocks({ ...env, DATABASE_MIGRATE_URL: direct.replace("/tend_preview_fresh", "/neondb") }, {}, /name different databases/);
  blocks(env, { db: "tend_production" }, /expected "tend_production"/);
  blocks(env, { runtimeUser: "neondb_owner" }, /expected the runtime login "neondb_owner"/);
  blocks(env, { migrateUser: "tend_runtime_v2" }, /expected the migration login/);
  assert.ok(checkProductionConfig({ ...env, DATABASE_MIGRATE_URL: direct.replace("ep-x.", "ep-y.") }).warnings.some((w) => /different hosts/.test(w)));
  const { out, code } = cli(asFile(env), "--expect-db", "neondb");
  assert.equal(code, 1);
  assert.match(out, /DATABASE_URL targets database "tend_preview_fresh", expected "neondb"/);
  assert.ok(!out.includes("pw-not-printed") && !out.includes("ep-x"), "no password and no host printed");
});

test("PROD-6 a connection string without its password (or without a user) is blocking, and named, before anything connects", () => {
  const noPw = (user) => `postgres://${user}@db.example.net/tend?sslmode=require`;
  const p1 = checkProductionConfig({ ...good, DATABASE_URL: noPw("tend_app") }).problems;
  assert.ok(p1.some((p) => /DATABASE_URL has no password in it/.test(p)), p1.join(" | "));
  const p2 = checkProductionConfig({ ...good, DATABASE_MIGRATE_URL: noPw("owner") }).problems;
  assert.ok(p2.some((p) => /DATABASE_MIGRATE_URL has no password in it/.test(p)), p2.join(" | "));
  const p3 = checkProductionConfig({ ...good, DATABASE_URL: "postgres://db.example.net/tend?sslmode=require" }).problems;
  assert.ok(p3.some((p) => /DATABASE_URL names no database user/.test(p)));
  // A local database may use trust or peer authentication without a password.
  assert.ok(!checkProductionConfig({ ...good, DATABASE_URL: "postgres://tend_app@127.0.0.1:5432/tend" }).problems.some((p) => /password/.test(p)));
});

test("PROD-7 --expect-endpoint pins both URLs to one Neon branch (its compute endpoint), pooled or direct, without printing the host", () => {
  const neon = (user, host) => `postgres://${user}:${"p".repeat(24)}@${host}/tend?sslmode=require`;
  const env = { ...good, DATABASE_URL: neon("tend_app", "ep-quiet-sky-a1b2c3-pooler.eu-central-1.aws.neon.tech"), DATABASE_MIGRATE_URL: neon("owner", "ep-quiet-sky-a1b2c3.eu-central-1.aws.neon.tech") };
  assert.deepEqual(checkProductionConfig(env, { endpoint: "ep-quiet-sky-a1b2c3" }).problems, []);
  const other = checkProductionConfig({ ...env, DATABASE_URL: neon("tend_app", "ep-other-main-z9y8x7-pooler.eu-central-1.aws.neon.tech") }, { endpoint: "ep-quiet-sky-a1b2c3" }).problems;
  assert.equal(other.length, 1, other.join(" | "));
  assert.match(other[0], /DATABASE_URL is not on the Neon endpoint "ep-quiet-sky-a1b2c3"/);
  assert.ok(!other[0].includes("ep-other-main"), "the actual host is not printed");
  assert.equal(checkProductionConfig({ ...env, DATABASE_MIGRATE_URL: neon("owner", "ep-other-main-z9y8x7.eu-central-1.aws.neon.tech") }, { endpoint: "ep-quiet-sky-a1b2c3" }).problems.length, 1);
});
