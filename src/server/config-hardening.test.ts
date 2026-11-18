import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "./config.ts";

const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try { fn(); } finally { for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v); }
};

test("TEND_APP_URL: a production server only puts https links into mails; development and local-only servers may use http", () => {
  withEnv({ NODE_ENV: "production", TEND_LOCAL_HTTP: undefined, VERCEL: undefined, TEND_APP_URL: "http://tend.example.com" }, () => assert.equal(config.appUrl, ""));
  withEnv({ NODE_ENV: "production", TEND_LOCAL_HTTP: undefined, VERCEL: undefined, TEND_APP_URL: "https://tend.example.com/" }, () => assert.equal(config.appUrl, "https://tend.example.com"));
  withEnv({ NODE_ENV: "production", TEND_LOCAL_HTTP: undefined, VERCEL: undefined, TEND_APP_URL: "https://tend.example.com/path?x=1" }, () => assert.equal(config.appUrl, ""));
  withEnv({ NODE_ENV: "development", TEND_APP_URL: "http://localhost:3000" }, () => assert.equal(config.appUrl, "http://localhost:3000"));
  withEnv({ NODE_ENV: "production", TEND_LOCAL_HTTP: "1", VERCEL: undefined, DATABASE_URL: undefined, POSTGRES_URL: undefined, TEND_TRUSTED_PROXY: undefined, TEND_APP_URL: "http://127.0.0.1:3000" }, () => assert.equal(config.appUrl, "http://127.0.0.1:3000"));
});

test("a weak or missing admin token is refused in production, so operator sign-in stays off instead of weak", () => {
  withEnv({ NODE_ENV: "production", TEND_ADMIN: undefined, TEND_ADMIN_TOKEN: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, () => assert.equal(config.adminToken, ""));
  withEnv({ NODE_ENV: "production", TEND_ADMIN: undefined, TEND_ADMIN_TOKEN: "short" }, () => assert.equal(config.adminToken, ""));
  withEnv({ NODE_ENV: "production", TEND_ADMIN: undefined, TEND_ADMIN_TOKEN: "Zk3qP9vLx2mW8tYh5NcRb7JdFg4sAe1UoQ6iXy0TpVn" }, () => assert.equal(config.adminToken.length > 0, true));
});

test("a production build is never public by default, even with no usable admin token; development keeps its read-only sample view; TEND_PUBLIC=1 is explicit", () => {
  const prod = { NODE_ENV: "production", TEND_ADMIN: undefined } as const;
  withEnv({ ...prod, TEND_PUBLIC: undefined, TEND_ADMIN_TOKEN: undefined }, () => assert.equal(config.public, false, "no token, unset: locked"));
  withEnv({ ...prod, TEND_PUBLIC: undefined, TEND_ADMIN_TOKEN: "weakweakweakweakweakweakweakweak" }, () => assert.equal(config.public, false, "weak token, unset: locked"));
  withEnv({ ...prod, TEND_PUBLIC: "1", TEND_ADMIN_TOKEN: undefined }, () => assert.equal(config.public, true, "explicit"));
  withEnv({ ...prod, TEND_PUBLIC: "0", TEND_ADMIN_TOKEN: undefined }, () => assert.equal(config.public, false));
  withEnv({ NODE_ENV: "development", TEND_ADMIN: undefined, TEND_PUBLIC: undefined, TEND_ADMIN_TOKEN: undefined }, () => assert.equal(config.public, true));
  withEnv({ NODE_ENV: "production", TEND_ADMIN: "0", TEND_PUBLIC: "1" }, () => assert.equal(config.public, false, "admin off never means public"));
});
