// The production preflight (scripts/check-production-config.mjs): a correct setup passes, each missing requirement blocks, no value is printed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkProductionConfig } from "../check-production-config.mjs";

const good = {
  DATABASE_URL: "postgres://tend_app:pw-runtime@db.example.net/tend?sslmode=require", DATABASE_MIGRATE_URL: "postgres://owner:pw-owner@db.example.net/tend?sslmode=require",
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
  for (const v of [...Object.values(good), "tooshortsecretvalue", "pw-runtime", "pw-owner"]) assert.ok(!out.includes(v), "no value printed");
});
