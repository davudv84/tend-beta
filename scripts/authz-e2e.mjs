#!/usr/bin/env node
// End-to-end check of pre-execution authorization over real HTTP, against an isolated server it starts itself:
// a fresh embedded database in a temp directory, a random throwaway admin token, demo off, no DATABASE_URL.
// Only fake agents and fake data. Needs a build first:  npm run build && npm run e2e:authz
// Takes about 70 seconds, most of it waiting for a token to expire.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = 3900 + Math.floor(Math.random() * 90);
const URL_ = `http://127.0.0.1:${PORT}`;
const ADMIN = `fake_admin_${randomBytes(18).toString("hex")}`;
const dir = mkdtempSync(path.join(tmpdir(), "tend-authz-e2e-"));
const env = { ...process.env, TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: dir, TEND_DEMO: "0", TEND_PUBLIC: "0", DATABASE_URL: "", POSTGRES_URL: "", ANTHROPIC_API_KEY: "", NODE_ENV: "production", TEND_TRUSTED_PROXY: "1" };
const server = spawn("npx", ["next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { env, stdio: ["ignore", "ignore", "pipe"] });
let serverErr = "";
server.stderr.on("data", (b) => (serverErr += b));

const results = [];
const seen = []; // every response body except token claims, checked for leaked secrets at the end
let cookie = "";

async function call(method, p, { body, key, op, origin, headers = {} } = {}) {
  const res = await fetch(URL_ + p, {
    method,
    headers: {
      ...(body !== undefined && { "content-type": "application/json" }),
      ...(key && { authorization: `Bearer ${key}` }),
      ...(op && { cookie }),
      ...(origin && { origin }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!p.endsWith("/token")) seen.push(text);
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message.split("\n")[0]]);
  }
}

/** Rate limits count calendar minutes; a step that counts across one waits out a minute that is about to roll over. */
const awayFromMinuteBoundary = async (needMs = 12_000) => {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < needMs) await new Promise((r) => setTimeout(r, left + 100));
};

const az = (key, req, idem) => call("POST", "/api/v1/authorizations", { key, body: req, headers: idem ? { "idempotency-key": idem } : {} });
const claim = (key, id) => call("POST", `/api/v1/authorizations/${id}/token`, { key });
const consume = (key, id, token, req) => call("POST", `/api/v1/authorizations/${id}/consume`, { key, body: { token, ...req } });
const decide = (id, status, opts = { op: true }) => call("POST", `/api/v1/reviews/${id}`, { ...opts, body: { status } });
const report = (key, req, outcome, authorizationId) =>
  call("POST", "/api/v1/events", { key, body: { type: "tool.called", data: { ...req, outcome, ...(authorizationId && { authorizationId }) } } });
// The snapshot nests the read model under `projection` (src/server/sync.ts; src/lib/store.ts reads it the same way).
const state = async () => {
  const r = await call("GET", "/api/v1/state", { op: true });
  assert.equal(r.status, 200, `operator snapshot: ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(r.body.projection && Array.isArray(r.body.projection.log) && Array.isArray(r.body.projection.authorizations), "snapshot has no projection");
  return r.body;
};
const alerts = async (agentId) => (await state()).projection.log.filter((l) => l.agentId === agentId && /authorization_|unauthorized/.test(l.type) && l.args?.blocked !== undefined);

const PAY = { tool: "send_payment", action: "execute", resource: "INV-9001", detail: "EUR 12.34 to Fake Supplier GmbH" };
const READ = { tool: "read_document", action: "read", resource: "DOC-P-1" };
const SECRET = { tool: "read_document", action: "read", resource: "DOC-R-7" };
const POLICY = {
  enforcement: "enforce",
  rules: [
    { tool: "send_payment", action: "execute", effect: "approve" },
    { tool: "read_document", action: "read", resourcePrefix: "DOC-R-", effect: "deny" },
    { tool: "read_document", action: "read", effect: "allow" },
  ],
};

try {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error(`server exited: ${serverErr.slice(-500)}`);
    if (i > 120) throw new Error("server did not start within 60s");
    if (await fetch(`${URL_}/api/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const login = await call("POST", "/api/operator/session", { body: { token: ADMIN } });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];

  let A, B; // { id, key }
  await step("registration: operator registers agents; key shown once, visitors and agents cannot register", async () => {
    const r = await call("POST", "/api/v1/agents", { op: true, body: { name: "Fake Payer", model: "fake-model", provider: "Anthropic" } });
    assert.equal(r.status, 201);
    assert.match(r.body.apiKey, /^tend_sk_/);
    A = { id: r.body.agent.id, key: r.body.apiKey };
    const r2 = await call("POST", "/api/v1/agents", { op: true, body: { name: "Fake Other", model: "fake-model", provider: "Anthropic" } });
    B = { id: r2.body.agent.id, key: r2.body.apiKey };
    assert.equal((await call("POST", "/api/v1/agents", { body: { name: "x", model: "m", provider: "Anthropic" } })).status, 403);
    assert.equal((await call("POST", "/api/v1/agents", { key: A.key, body: { name: "x", model: "m", provider: "Anthropic" } })).status, 403);
    assert.equal((await call("POST", "/api/v1/agents", { op: true, origin: "https://evil.example", body: { name: "x", model: "m", provider: "Anthropic" } })).status, 403);
  });

  await step("default deny: a new agent with no policy is denied everything (403 no_policy)", async () => {
    const r = await az(A.key, READ);
    assert.equal(r.status, 403);
    assert.equal(r.body.status, "denied");
    assert.equal(r.body.reason, "no_policy");
  });

  await step("policy: only an operator can set it; an invalid policy is refused whole", async () => {
    assert.equal((await call("POST", `/api/v1/agents/${A.id}/policy`, { key: A.key, body: POLICY })).status, 403);
    assert.equal((await call("POST", `/api/v1/agents/${A.id}/policy`, { body: POLICY })).status, 403);
    const bad = await call("POST", `/api/v1/agents/${A.id}/policy`, { op: true, body: { rules: [...POLICY.rules, { tool: "x", action: "y", effect: "maybe" }] } });
    assert.equal(bad.status, 422);
    assert.equal((await az(A.key, READ)).status, 403, "the invalid policy must not have been half applied");
    assert.equal((await call("POST", `/api/v1/agents/${A.id}/policy`, { op: true, body: POLICY })).status, 200);
    assert.equal((await call("POST", `/api/v1/agents/${B.id}/policy`, { op: true, body: POLICY })).status, 200);
    const inbox = await call("GET", "/api/v1/agent/inbox", { key: A.key });
    assert.equal(inbox.body.config.enforcement, "enforce");
  });

  await step("authentication: no key, a wrong key or a malformed key is refused (401)", async () => {
    assert.equal((await az(undefined, READ)).status, 401);
    assert.equal((await az(`tend_sk_${"A".repeat(32)}`, READ)).status, 401);
    assert.equal((await az("not-a-key", READ)).status, 401);
  });

  await step("allowed by policy: approved at once, token claimed, consumed once, execution reported cleanly", async () => {
    const r = await az(A.key, READ);
    assert.equal(r.status, 201);
    assert.equal(r.body.status, "approved");
    const t = await claim(A.key, r.body.id);
    assert.equal(t.status, 200);
    assert.match(t.body.token, /^tend_az_[A-Za-z0-9_-]{43}$/);
    const c = await consume(A.key, r.body.id, t.body.token, READ);
    assert.equal(c.status, 200);
    assert.equal(c.body.authorized, true);
    assert.equal((await report(A.key, READ, "success", r.body.id)).status, 202);
    assert.equal((await call("GET", `/api/v1/authorizations/${r.body.id}`, { key: A.key })).body.status, "consumed");
  });

  await step("denied by policy: restricted resource gets 403 policy_denied and no token can be claimed", async () => {
    const r = await az(A.key, SECRET);
    assert.equal(r.status, 403);
    assert.equal(r.body.reason, "policy_denied");
    const t = await claim(A.key, r.body.id);
    assert.equal(t.status, 403);
    assert.equal(t.body.token, undefined);
  });

  let payId;
  await step("pending authorization: waits for a human; no token, and a guessed token cannot consume it", async () => {
    const r = await az(A.key, PAY);
    assert.equal(r.status, 201);
    assert.equal(r.body.status, "pending");
    payId = r.body.id;
    const t = await claim(A.key, payId);
    assert.equal(t.status, 202);
    assert.equal(t.body.token, undefined);
    const c = await consume(A.key, payId, `tend_az_${"x".repeat(43)}`, PAY);
    assert.equal(c.status, 403);
  });

  await step("approval: agents and visitors cannot approve; cross-site approval refused; operator approves", async () => {
    assert.equal((await decide(payId, "approved", { key: A.key })).status, 403);
    assert.equal((await decide(payId, "approved", {})).status, 403);
    assert.equal((await decide(payId, "approved", { op: true, origin: "https://evil.example" })).status, 403);
    assert.equal((await decide(payId, "acknowledged")).status, 422);
    const d = await decide(payId, "approved");
    assert.equal(d.status, 200);
    assert.equal((await decide(payId, "rejected")).status, 409, "a decision is final");
  });

  let payToken;
  await step("execution blocking: changed amount, payee, resource or a foreign token is refused (403), approval survives", async () => {
    payToken = (await claim(A.key, payId)).body.token;
    assert.ok(payToken);
    assert.equal((await consume(A.key, payId, payToken, { ...PAY, detail: "EUR 99999.00 to Attacker Ltd" })).status, 403);
    assert.equal((await consume(A.key, payId, payToken, { ...PAY, resource: "INV-9002" })).body.error, "mismatch");
    assert.equal((await consume(A.key, payId, payToken, { ...PAY, unknown: 1 })).status, 422);
    assert.equal((await call("GET", `/api/v1/authorizations/${payId}`, { key: A.key })).body.status, "approved");
  });

  await step("cross-agent isolation: another agent cannot see, claim, consume or cancel it (404)", async () => {
    assert.equal((await call("GET", `/api/v1/authorizations/${payId}`, { key: B.key })).status, 404);
    assert.equal((await claim(B.key, payId)).status, 404);
    assert.equal((await consume(B.key, payId, payToken, PAY)).status, 404);
    assert.equal((await call("POST", `/api/v1/authorizations/${payId}/cancel`, { key: B.key })).status, 404);
  });

  await step("approved and consumed once; the response says authorized, not executed", async () => {
    const c = await consume(A.key, payId, payToken, PAY);
    assert.equal(c.status, 200);
    assert.deepEqual(c.body, { authorized: true, authorizationId: payId, ...PAY });
    assert.equal((await report(A.key, PAY, "success", payId)).status, 202);
  });

  await step("replay protection: the spent token is refused (409) and both replays raise alerts", async () => {
    const c = await consume(A.key, payId, payToken, PAY);
    assert.equal(c.status, 409);
    assert.equal(c.body.error, "already_consumed");
    assert.equal((await claim(A.key, payId)).status, 403, "no new token for a consumed authorization");
    await report(A.key, PAY, "success", payId); // a second execution against one authorization
    const kinds = (await alerts(A.id)).map((l) => `${l.type}:${l.args.reason}:${l.args.blocked}`);
    assert.ok(kinds.includes("authorization_replay:replay:true"), kinds.join());
    assert.ok(kinds.includes("authorization_replay:executed_twice:false"), kinds.join());
  });

  await step("idempotent request: same key returns the same request (200); a different body is 409", async () => {
    const a = await az(A.key, { ...PAY, resource: "INV-9003" }, "idem-1");
    const b = await az(A.key, { ...PAY, resource: "INV-9003" }, "idem-1");
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(a.body.id, b.body.id);
    assert.equal((await az(A.key, { ...PAY, resource: "INV-9004" }, "idem-1")).status, 409);
    await call("POST", `/api/v1/authorizations/${a.body.id}/cancel`, { key: A.key });
  });

  await step("rejection: rejected request never gets a token, cannot be approved later or consumed", async () => {
    const r = await az(A.key, { ...PAY, resource: "INV-9005" });
    assert.equal((await decide(r.body.id, "rejected")).status, 200);
    const t = await claim(A.key, r.body.id);
    assert.equal(t.status, 403);
    assert.equal(t.body.status, "rejected");
    assert.equal((await decide(r.body.id, "approved")).status, 409);
    assert.equal((await consume(A.key, r.body.id, payToken, { ...PAY, resource: "INV-9005" })).status, 403);
  });

  await step("cancel: a cancelled request cannot be approved or claimed", async () => {
    const r = await az(A.key, { ...PAY, resource: "INV-9006" });
    assert.equal((await call("POST", `/api/v1/authorizations/${r.body.id}/cancel`, { key: A.key })).body.status, "cancelled");
    assert.equal((await decide(r.body.id, "approved")).status, 409);
    assert.equal((await claim(A.key, r.body.id)).status, 403);
  });

  await step("pausing blocks execution even with a token in hand; resuming restores it", async () => {
    const r = await az(A.key, { ...READ, resource: "DOC-P-2" });
    const tok = (await claim(A.key, r.body.id)).body.token;
    assert.equal((await call("POST", `/api/v1/agents/${A.id}/control`, { op: true, body: { action: "pause" } })).status, 200);
    const c = await consume(A.key, r.body.id, tok, { ...READ, resource: "DOC-P-2" });
    assert.equal(c.status, 403);
    assert.equal(c.body.reason, "agent_paused");
    assert.equal((await az(A.key, READ)).body.reason, "agent_paused");
    assert.equal((await call("POST", `/api/v1/agents/${A.id}/control`, { op: true, body: { action: "resume" } })).status, 200);
    assert.equal((await consume(A.key, r.body.id, tok, { ...READ, resource: "DOC-P-2" })).status, 200);
  });

  await step("mismatch limit: three wrong attempts revoke the approval", async () => {
    const r = await az(A.key, { ...READ, resource: "DOC-P-3" });
    const tok = (await claim(A.key, r.body.id)).body.token;
    for (let i = 0; i < 3; i++) await consume(A.key, r.body.id, tok, { ...READ, resource: `DOC-P-X${i}` });
    assert.equal((await call("GET", `/api/v1/authorizations/${r.body.id}`, { key: A.key })).body.status, "cancelled");
    assert.equal((await consume(A.key, r.body.id, tok, { ...READ, resource: "DOC-P-3" })).status, 403);
  });

  await step("unauthorized execution: in enforce mode a governed tool run without authorization raises an alert", async () => {
    await report(A.key, { ...PAY, resource: "INV-9999" }, "success");
    assert.ok((await alerts(A.id)).some((l) => l.type === "unauthorized_execution"));
  });

  await step("expiration: a token unused for 60s is refused (token_expired); a fresh claim works", async () => {
    const req = { ...PAY, resource: "INV-9007" };
    const r = await az(A.key, req);
    await decide(r.body.id, "approved");
    const tok = (await claim(A.key, r.body.id)).body.token;
    await new Promise((res) => setTimeout(res, 61_000));
    const c = await consume(A.key, r.body.id, tok, req);
    assert.equal(c.status, 403);
    assert.equal(c.body.error, "token_expired");
    const fresh = (await claim(A.key, r.body.id)).body.token;
    assert.notEqual(fresh, tok);
    assert.equal((await consume(A.key, r.body.id, tok, req)).status, 403, "the old token stays dead");
    assert.equal((await consume(A.key, r.body.id, fresh, req)).status, 200);
  });

  await step("dashboard: operator snapshot lists every status with the bound detail, and incremental sync agrees", async () => {
    const s = await state();
    const mine = s.projection.authorizations.filter((a) => a.agentId === A.id);
    const statuses = new Set(mine.map((a) => a.status));
    for (const st of ["consumed", "denied", "rejected", "cancelled"]) assert.ok(statuses.has(st), `missing ${st} in ${[...statuses]}`);
    const pay = mine.find((a) => a.id === payId);
    assert.equal(pay.status, "consumed");
    assert.equal(pay.detail, PAY.detail);
    const r = await az(A.key, { ...PAY, resource: "INV-9008" });
    const inc = (await call("GET", `/api/v1/events?since=${s.seq}`, { op: true })).body;
    const evs = JSON.stringify(inc);
    assert.ok(evs.includes(r.body.id), "the new pending request arrives through incremental sync");
    await decide(r.body.id, "approved");
    const after = (await state()).projection.authorizations.find((a) => a.id === r.body.id);
    assert.equal(after.status, "approved");
  });

  await step("visitors on a private instance cannot read the dashboard (401 sign_in_required, no data)", async () => {
    // 401, not 403: the client shows the sign-in screen on 401 (src/lib/store.ts). An agent key is not an operator session.
    for (const opts of [{}, { key: A.key }, { headers: { cookie: `tend_operator=${Date.now() + 3_600_000}.forged` } }])
      for (const p of ["/api/v1/state", "/api/v1/events?since=0"]) {
        const r = await call("GET", p, opts);
        assert.equal(r.status, 401, `${p} ${JSON.stringify(opts)}: ${r.status}`);
        assert.equal(r.body.error, "sign_in_required");
        assert.deepEqual(Object.keys(r.body).sort(), ["error", "message"], `${p} leaked data`);
      }
  });

  await step("key revocation: only an operator can revoke; the old key is dead on every agent route and its waiting request is cancelled", async () => {
    const reg = await call("POST", "/api/v1/agents", { op: true, body: { name: "Fake Revoked", model: "fake-model", provider: "Anthropic" } });
    const C = { id: reg.body.agent.id, key: reg.body.apiKey };
    assert.equal((await call("POST", `/api/v1/agents/${C.id}/policy`, { op: true, body: POLICY })).status, 200);
    const waiting = await az(C.key, PAY);
    assert.equal(waiting.status, 201);
    const url = `/api/v1/agents/${C.id}/keys`;
    for (const [who, opts] of [["a visitor", {}], ["the agent itself", { key: C.key }], ["another agent", { key: B.key }], ["a cross-site page", { op: true, origin: "https://evil.example" }]]) {
      assert.equal((await call("DELETE", url, opts)).status, 403, `${who} must not revoke`);
      assert.equal((await az(C.key, READ)).status, 201, `${who}: the key still works`);
    }
    const r = await call("DELETE", url, { op: true });
    assert.deepEqual([r.status, r.body.revoked], [200, true]);
    assert.ok(r.body.cancelled >= 1, "the request that was waiting was cancelled");
    for (const [method, p, body] of [["POST", "/api/v1/authorizations", PAY], ["GET", "/api/v1/agent/inbox"], ["POST", "/api/v1/gateway/requests", { tool: "test_ping", params: { message: "hi" } }], ["POST", "/api/v1/events", { type: "task.started", data: { taskId: "t1", title: "x" } }], ["GET", `/api/v1/authorizations/${waiting.body.id}`]]) {
      const x = await call(method, p, { key: C.key, ...(body && { body }) });
      assert.equal(x.status, 401, `${method} ${p} with the revoked key: ${x.status}`);
    }
    assert.equal((await decide(waiting.body.id, "approved")).status, 409, "the cancelled request can no longer be approved");
    assert.deepEqual((await call("DELETE", url, { op: true })).body.revoked, false, "repeating it changes nothing");
    assert.equal((await state()).projection.log.filter((l) => l.agentId === C.id && l.type === "key_revoked").length, 1);
    const fresh = await call("POST", url, { op: true });
    assert.equal(fresh.status, 201);
    assert.equal((await az(fresh.body.apiKey, READ)).status, 201, "rotating gives the agent access again");
    assert.equal((await az(C.key, READ)).status, 401, "and the revoked key stays dead");
  });

  const signInAs = (xff, token = ADMIN) => call("POST", "/api/operator/session", { body: { token }, headers: xff ? { "x-forwarded-for": xff } : {} });
  await step("sign-in abuse: ten failures a minute per trusted address, a forged X-Forwarded-For counts for nothing, nobody else is locked out", async () => {
    await awayFromMinuteBoundary();
    const CANARY = "E2E-WRONG-CANARY-7c41d9";
    // Behind one trusted proxy the address that counts is the last one. The attacker writes anything in front of it.
    const codes = [];
    for (let i = 0; i < 14; i++) codes.push((await signInAs(`10.1.${i}.1, 203.0.113.99`, CANARY)).status);
    assert.deepEqual(codes, [401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 429, 429, 429, 429], codes.join(" "));
    assert.equal((await signInAs("10.9.9.9, 203.0.113.99")).status, 429, "the right token from that address is refused too, for the rest of the minute");
    // The operator is on another address, and nothing the attacker claimed touches it.
    assert.equal((await signInAs("198.51.100.7")).status, 200);
    assert.equal((await signInAs("203.0.113.99, 198.51.100.7")).status, 200, "claiming the attacker's address in front of the operator's own changes nothing");
    // With no trusted address at all (here a header that is not an address, as some proxies send) nobody is refused: the correct
    // token always works, wrong ones are only slowed. (A request with no header gets the socket's own address from Next.js, so it is not "unknown".)
    const anon = [];
    for (let i = 0; i < 13; i++) anon.push((await signInAs("unknown", CANARY)).status);
    assert.deepEqual([...new Set(anon)], [401], `never a 429 for an unattributed caller: ${anon.join(" ")}`);
    assert.equal((await signInAs("unknown")).status, 200, "and the correct token works in the middle of it");
    // What was recorded names the outcome and the address, never the token.
    const o = await call("GET", "/api/operator/sessions", { op: true });
    assert.equal(o.status, 200);
    const text = JSON.stringify(o.body);
    assert.ok(o.body.recent.some((e) => e.type === "signin.failed" && e.client === "203.0.113.99"), "failures are logged with the trusted address");
    assert.ok(o.body.recent.some((e) => e.type === "signin.blocked"), "and so is the block");
    assert.equal(text.includes(CANARY) || text.includes(ADMIN), false, "no credential in the log");
  });

  await step("sessions: strict cookie, server-side sign-out, replay refused, 'sign out everywhere' ends them all, and a fresh sign-in works", async () => {
    const r = await signInAs("198.51.100.20");
    assert.equal(r.status, 200);
    const sc = r.headers.get("set-cookie");
    assert.match(sc, /^__Host-tend_operator=[a-f0-9]{16}\.[A-Za-z0-9_-]{43};/, "an opaque id and a 256-bit secret under the __Host- name");
    for (const attr of ["Path=/", "HttpOnly", "SameSite=Strict", "Secure", "Max-Age=43200"]) assert.ok(sc.split("; ").includes(attr), `cookie lacks ${attr}: ${sc}`);
    assert.equal(/domain/i.test(sc), false);
    const mine = { cookie: sc.split(";")[0] };
    const view = async (h) => (await call("GET", "/api/v1/state", { headers: h })).status;
    assert.equal(await view(mine), 200);
    const out = await call("DELETE", "/api/operator/session", { headers: mine });
    assert.equal(out.status, 200);
    assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
    for (let i = 0; i < 3; i++) assert.equal(await view(mine), 401, "the signed-out cookie, replayed, gets nothing");
    assert.equal((await call("POST", "/api/v1/agents", { headers: mine, body: { name: "x", model: "m", provider: "Anthropic" } })).status, 403, "and cannot change anything");
    // An id alone signs nobody out.
    const two = await signInAs("198.51.100.21"), three = await signInAs("198.51.100.22");
    const c2 = two.headers.get("set-cookie").split(";")[0], c3 = three.headers.get("set-cookie").split(";")[0];
    const idOnly = { cookie: c2.split(".")[0] };
    await call("DELETE", "/api/operator/session", { headers: idOnly });
    assert.equal(await view({ cookie: c2 }), 200, "the id by itself did not end the session");
    // A visitor cannot revoke or list; an operator can, and it takes effect on the next request.
    assert.equal((await call("DELETE", "/api/operator/sessions")).status, 403);
    assert.equal((await call("GET", "/api/operator/sessions")).status, 403);
    assert.equal((await call("DELETE", "/api/operator/sessions", { headers: { cookie: c3 }, origin: "https://evil.example" })).status, 403, "not from another site");
    const all = await call("DELETE", "/api/operator/sessions", { headers: { cookie: c3 } });
    assert.equal(all.status, 200);
    assert.ok(all.body.revoked >= 3, `revoked ${all.body.revoked}`);
    for (const h of [{ cookie: c2 }, { cookie: c3 }, { cookie }]) assert.equal(await view(h), 401);
    const again = await signInAs("198.51.100.23");
    assert.equal(again.status, 200);
    cookie = again.headers.get("set-cookie").split(";")[0]; // the rest of the run continues with this one
    assert.equal(await view({ cookie }), 200);
  });

  await step("flooding: one agent key cannot queue more than 20 requests for a person, or store more than its minute's allowance of events", async () => {
    await awayFromMinuteBoundary();
    const reg = await call("POST", "/api/v1/agents", { op: true, body: { name: "Fake Looper", model: "fake-model", provider: "Anthropic" } });
    const D = { id: reg.body.agent.id, key: reg.body.apiKey };
    const codes = [];
    for (let i = 0; i < 25; i++) codes.push(await call("POST", "/api/v1/events", { key: D.key, body: { type: "review.requested", data: { reason: `look at ${i}` } } }));
    assert.deepEqual([codes.filter((r) => r.status === 202).length, codes.filter((r) => r.status === 429 && r.body.error === "too_many_pending_reviews").length], [20, 5]);
    assert.ok(Number(codes.at(-1).headers.get("retry-after")) >= 1, "a refusal says when to retry");
    let stored = 25, quota;
    for (let i = 0; i < 20 && !quota; i++) {
      const r = await call("POST", "/api/v1/events", { key: D.key, body: { events: Array.from({ length: 50 }, (_, j) => ({ type: "task.started", data: { taskId: `t${i}-${j}`, title: "work" } })) } });
      if (r.status === 202) stored += 50;
      else quota = r;
    }
    assert.ok(quota, "the flood was stopped");
    assert.deepEqual([quota.status, quota.body.error, quota.body.quota], [429, "agent_quota_exceeded", "events_per_minute"]);
    assert.ok(stored <= 600, `stored ${stored} events in one minute from one key`);
    const hits = (await state()).projection.reviews?.filter?.((x) => x.agentId === D.id && x.status === "pending") ?? null;
    if (hits) assert.ok(hits.length <= 20, `${hits.length} pending items for one agent`);
    // Another agent is not slowed down by it.
    assert.equal((await call("POST", "/api/v1/events", { key: B.key, body: { type: "task.started", data: { taskId: "ok", title: "fine" } } })).status, 202);
  });

  await step("secrets: no authorization token, token hash, agent key or admin token appears in any other response", async () => {
    const all = seen.join("\n");
    assert.equal(/tend_az_[A-Za-z0-9_-]{43}/.test(all.replaceAll(`tend_az_${"x".repeat(43)}`, "")), false, "token leaked");
    assert.equal(all.includes(ADMIN), false, "admin token leaked");
    assert.equal(/token_hash|fingerprint/.test(all), false, "hash leaked");
    const keys = seen.filter((t) => /tend_sk_[A-Za-z0-9_-]{24,}/.test(t));
    assert.equal(keys.length, 5, "agent keys appear only in the four registration responses and the one rotation");
  });
} catch (e) {
  results.push(["FAIL", "harness", e.message]);
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  rmSync(dir, { recursive: true, force: true });
}

for (const [s, name, why] of results) console.log(`${s}  ${name}${why ? `\n      ${why}` : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
