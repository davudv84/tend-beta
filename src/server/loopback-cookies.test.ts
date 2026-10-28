// Safari refuses a `Secure` cookie over plain http://, even on loopback, so a production build used on your own machine (the isolated try-out
// server, `npm run build && npm start`) could never keep an operator sign-in there: the token was accepted, the cookie dropped, the form came
// back. TEND_LOCAL_HTTP=1 relaxes the cookie, and ONLY for a loopback address over plain http. Everything else keeps the secure, host-locked cookie.
// Reproduced in real WebKit before the fix (scripts/browser-e2e.mjs); these tests pin the rules that keep the relaxation from widening.
import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryDb } from "./db.ts";
import { activeSession, createSession, plainLoopback, SESSION_TTL, sessionCookieName, sessionHeader } from "./session.ts";

const TOKEN = "loopback-admin-token-0123456789abcdef";
process.env.TEND_ADMIN_TOKEN = TOKEN;

const ENV = ["NODE_ENV", "TEND_LOCAL_HTTP", "VERCEL", "TEND_TRUSTED_PROXY", "DATABASE_URL", "POSTGRES_URL"] as const;
async function withEnv(env: Partial<Record<(typeof ENV)[number], string | undefined>>, fn: () => Promise<void> | void) {
  const before = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const set = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : void (process.env[k] = v));
  for (const k of ENV) set(k, undefined);
  for (const [k, v] of Object.entries(env)) set(k, v);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) set(k, v as string | undefined);
  }
}
const at = (url: string, cookie?: string) => new Request(url, { headers: cookie ? { cookie } : {} });
const PROD = { NODE_ENV: "production" };

test("production default is unchanged: __Host- name, Secure, HttpOnly, SameSite=Strict, whatever the address", async () => {
  await withEnv(PROD, () => {
    for (const url of ["http://127.0.0.1:3000/", "http://localhost:3000/", "https://tend.example/"]) {
      const h = sessionHeader("v", SESSION_TTL, at(url));
      assert.match(h, /^__Host-tend_operator=v;/);
      for (const part of ["Secure", "HttpOnly", "SameSite=Strict", "Path=/"]) assert.ok(h.includes(part), `${url}: ${part}`);
    }
  });
});

test("with TEND_LOCAL_HTTP=1 a loopback address over http gets a plain cookie that is still HttpOnly and SameSite=Strict", async () => {
  await withEnv({ ...PROD, TEND_LOCAL_HTTP: "1" }, () => {
    for (const url of ["http://127.0.0.1:61234/operator", "http://localhost:3000/", "http://[::1]:3000/"]) {
      assert.equal(plainLoopback(at(url)), true, url);
      const h = sessionHeader("v", SESSION_TTL, at(url));
      assert.match(h, /^tend_operator=v;/, url);
      assert.equal(/Secure/.test(h), false, url);
      assert.ok(h.includes("HttpOnly") && h.includes("SameSite=Strict") && h.includes("Path=/"), url);
      assert.equal(/Domain/i.test(h), false);
    }
  });
});

test("the relaxation never widens: another host, a LAN address, https, a lookalike name or no request at all keep the secure cookie", async () => {
  await withEnv({ ...PROD, TEND_LOCAL_HTTP: "1" }, () => {
    for (const url of ["http://tend.example/", "https://tend.example/", "http://192.168.1.20:3000/", "http://10.0.0.5/", "https://127.0.0.1:3000/", "http://127.0.0.1.evil.example/", "http://localhost.evil.example/", "http://0.0.0.0:3000/", "http://[::ffff:7f00:1]/"]) {
      assert.equal(plainLoopback(at(url)), false, url);
      const h = sessionHeader("v", SESSION_TTL, at(url));
      assert.ok(h.startsWith("__Host-tend_operator=") && h.includes("Secure"), url);
    }
    assert.equal(plainLoopback(undefined), false);
    assert.match(sessionHeader("v", SESSION_TTL), /^__Host-tend_operator=v;.*Secure/);
    assert.equal(sessionCookieName(), "__Host-tend_operator");
  });
});

test("the flag is off unless it is exactly 1, and is ignored on Vercel, behind a trusted proxy and with a database URL (a hosted deployment)", async () => {
  for (const env of [{ ...PROD }, { ...PROD, TEND_LOCAL_HTTP: "true" }, { ...PROD, TEND_LOCAL_HTTP: "0" }, { ...PROD, TEND_LOCAL_HTTP: "1", VERCEL: "1" }, { ...PROD, TEND_LOCAL_HTTP: "1", TEND_TRUSTED_PROXY: "1" }, { ...PROD, TEND_LOCAL_HTTP: "1", DATABASE_URL: "postgres://u@db.example/x" }, { ...PROD, TEND_LOCAL_HTTP: "1", POSTGRES_URL: "postgres://u@db.example/x" }])
    await withEnv(env, () => {
      assert.equal(plainLoopback(at("http://127.0.0.1:3000/")), false, JSON.stringify(env));
      assert.match(sessionHeader("v", SESSION_TTL, at("http://127.0.0.1:3000/")), /^__Host-/);
    });
});

test("a session works end to end in the relaxed mode, and each mode accepts only its own cookie", async () => {
  const db = await memoryDb();
  try {
    const s = await createSession(db, {});
    await withEnv({ ...PROD, TEND_LOCAL_HTTP: "1" }, async () => {
      const local = "http://127.0.0.1:3000/api/v1/state";
      assert.equal(await activeSession(db, at(local, `tend_operator=${s.value}`)), s.id, "the plain cookie signs in on loopback");
      assert.equal(await activeSession(db, at(local, `__Host-tend_operator=${s.value}`)), undefined, "the secure name is not accepted in the relaxed mode");
      // The same plain cookie arriving at a non-loopback address is not a session: that request is judged by the secure rules.
      assert.equal(await activeSession(db, at("https://tend.example/api/v1/state", `tend_operator=${s.value}`)), undefined);
      assert.equal(await activeSession(db, at("http://192.168.1.20:3000/api/v1/state", `tend_operator=${s.value}`)), undefined);
    });
    await withEnv(PROD, async () => {
      assert.equal(await activeSession(db, at("http://127.0.0.1:3000/", `tend_operator=${s.value}`)), undefined, "without the flag a plain cookie is never a session");
      assert.equal(await activeSession(db, at("http://127.0.0.1:3000/", `__Host-tend_operator=${s.value}`)), s.id);
    });
  } finally {
    await db.close();
  }
});
