// The beta configuration generator and validator (scripts/beta-config.mjs): fresh secrets per instance, and every isolation rule enforced.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { check, loadAll, newConfig, provision } from "../../scripts/beta-config.mjs";

const neon = (project: string, db = "neondb") => `postgresql://owner:${randomBytes(12).toString("hex")}@ep-${project}-pooler.eu-central-1.aws.neon.tech/${db}?sslmode=require`;
const good = (project: string): Record<string, string> => ({ ...newConfig(), DATABASE_URL: neon(project) });
const fails = (r: { level: string; text: string }[]) => r.filter((x) => x.level === "fail").map((x) => x.text);

test("provision writes a private file per instance with its own strong token, and never overwrites existing secrets", () => {
  const root = mkdtempSync(path.join(tmpdir(), "tend-beta-"));
  try {
    assert.deepEqual(provision(root, ["alice", "bob", "carol"]), ["alice", "bob", "carol"]);
    const { instances, modes } = loadAll(root);
    assert.deepEqual(Object.keys(instances).sort(), ["alice", "bob", "carol"]);
    assert.ok(modes.every(([, m]) => m === 0o600), "each vercel.env is mode 600");
    assert.equal(statSync(path.join(root, "beta-envs")).mode & 0o777, 0o700);
    assert.equal(new Set(Object.values(instances).map((i) => i.TEND_ADMIN_TOKEN)).size, 3, "three different tokens");
    assert.equal(new Set(Object.values(instances).map((i) => i.TEND_GATEWAY_PAYMENTS_KEY)).size, 3);
    assert.ok(Object.values(instances).every((i) => i.TEND_PUBLIC === "0" && i.TEND_DEMO === "0" && i.DATABASE_URL === ""));
    assert.throws(() => provision(root, ["alice"]), /refusing to overwrite/);
    assert.throws(() => provision(root, ["Bad Name"]), /not a usable instance name/);
    const text = readFileSync(path.join(root, "beta-envs/alice/vercel.env"), "utf8");
    assert.match(text, /^TEND_ADMIN_TOKEN=[A-Za-z0-9_-]{43}$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("three correct, separate instances pass", () => {
  const r = check({ alice: good("a"), bob: good("b"), carol: good("c") });
  assert.deepEqual(fails(r), []);
  assert.deepEqual(r.filter((x) => x.level === "warn"), []);
});

test("every isolation rule is enforced: shared token, shared database, local or unsafe database, public or demo mode, local-only settings", () => {
  const a = good("a");
  const cases: [string, Record<string, string>, RegExp][] = [
    ["weak token", { ...good("b"), TEND_ADMIN_TOKEN: "a".repeat(40) }, /TEND_ADMIN_TOKEN is /],
    ["short token", { ...good("b"), TEND_ADMIN_TOKEN: "short" }, /TEND_ADMIN_TOKEN is /],
    ["shared token", { ...good("b"), TEND_ADMIN_TOKEN: a.TEND_ADMIN_TOKEN }, /same as alice/],
    ["shared database", { ...good("b"), DATABASE_URL: a.DATABASE_URL }, /same as alice/],
    ["shared payments key", { ...good("b"), TEND_GATEWAY_PAYMENTS_KEY: a.TEND_GATEWAY_PAYMENTS_KEY }, /same as alice/],
    ["same database on one host", { ...good("b"), DATABASE_URL: a.DATABASE_URL.replace(/:[a-f0-9]+@/, ":other@") }, /same as alice/],
    ["empty url", { ...good("b"), DATABASE_URL: "" }, /DATABASE_URL is empty/],
    ["local database", { ...good("b"), DATABASE_URL: "postgres://u:p@localhost:5432/x?sslmode=require" }, /this machine/],
    ["no ssl", { ...good("b"), DATABASE_URL: neon("b").replace("?sslmode=require", "") }, /sslmode=require/],
    ["not postgres", { ...good("b"), DATABASE_URL: "mysql://u:p@h/x?sslmode=require" }, /postgres/],
    ["public", { ...good("b"), TEND_PUBLIC: "1" }, /TEND_PUBLIC must be 0/],
    ["demo", { ...good("b"), TEND_DEMO: "1" }, /TEND_DEMO must be 0/],
    ["local http", { ...good("b"), TEND_LOCAL_HTTP: "1" }, /TEND_LOCAL_HTTP must not be set/],
    ["proxy count", { ...good("b"), TEND_TRUSTED_PROXY: "1" }, /TEND_TRUSTED_PROXY must not be set/],
    ["data dir", { ...good("b"), TEND_DATA_DIR: "/tmp/x" }, /TEND_DATA_DIR must not be set/],
  ];
  for (const [name, bob, re] of cases) assert.ok(fails(check({ alice: a, bob })).some((t) => re.test(t)), `${name}: ${fails(check({ alice: a, bob })).join(" | ")}`);
  // an unpooled host is a warning (works, but risks connection exhaustion), not a failure
  const r = check({ alice: a, bob: { ...good("b"), DATABASE_URL: neon("b").replace("-pooler", "") } });
  assert.deepEqual(fails(r), []);
  assert.ok(r.some((x) => x.level === "warn" && /pooled/.test(x.text)));
});

test("the checker never echoes a secret", () => {
  const a = good("a");
  const out = JSON.stringify(check({ alice: a, bob: { ...good("b"), TEND_ADMIN_TOKEN: a.TEND_ADMIN_TOKEN, DATABASE_URL: a.DATABASE_URL } }));
  for (const secret of [a.TEND_ADMIN_TOKEN, a.TEND_GATEWAY_PAYMENTS_KEY, new URL(a.DATABASE_URL).password]) assert.equal(out.includes(secret), false);
});
