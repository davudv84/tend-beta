#!/usr/bin/env node
// End-to-end check of the secure execution gateway over real HTTP, against an isolated server it starts itself:
// a fresh embedded database in a temp directory, a random throwaway admin token and gateway credential, demo off,
// no DATABASE_URL. Only fake agents, a fake payments API and fake data. Needs a build first:
//   npm run build && npm run e2e:gateway
// Takes about 75 seconds, most of it waiting for a token to expire.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = 3990 + Math.floor(Math.random() * 9);
const URL_ = `http://127.0.0.1:${PORT}`;
const ADMIN = `fake_admin_${randomBytes(18).toString("hex")}`;
const GW_KEY = `fake_gateway_${randomBytes(18).toString("hex")}`;
const dir = mkdtempSync(path.join(tmpdir(), "tend-gateway-e2e-"));
const env = {
  ...process.env, TEND_ADMIN_TOKEN: ADMIN, TEND_GATEWAY_PAYMENTS_KEY: GW_KEY, TEND_DATA_DIR: dir, TEND_DEMO: "0", TEND_PUBLIC: "0",
  DATABASE_URL: "", POSTGRES_URL: "", ANTHROPIC_API_KEY: "", NODE_ENV: "production",
};
const server = spawn("npx", ["next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { env, stdio: ["ignore", "pipe", "pipe"] });
let serverOut = "";
server.stdout.on("data", (b) => (serverOut += b));
server.stderr.on("data", (b) => (serverOut += b));

const results = [];
const seen = []; // every agent-facing response body except token claims
let cookie = "";

async function call(method, p, { body, raw, key, op, headers = {} } = {}) {
  const res = await fetch(URL_ + p, {
    method,
    headers: { ...((body !== undefined || raw) && { "content-type": "application/json" }), ...(key && { authorization: `Bearer ${key}` }), ...(op && { cookie }), ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
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

const ask = (key, params, tool = "pay_invoice") => call("POST", "/api/v1/gateway/requests", { key, body: { tool, params } });
const claim = (key, id) => call("POST", `/api/v1/authorizations/${id}/token`, { key });
const run = (key, id, token, params, extra = {}) => call("POST", "/api/v1/gateway/execute", { key, body: { authorizationId: id, token, tool: "pay_invoice", params, ...extra } });
const approve = (id) => call("POST", `/api/v1/reviews/${id}`, { op: true, body: { status: "approved" } });
const gwLog = async (agentId) => (await call("GET", "/api/v1/state", { op: true })).body.projection.taskEvents.filter((t) => t.agentId === agentId && /via gateway/.test(t.summary ?? ""));

let inv = 100;
const pay = (over = {}) => ({ invoice: `INV-${++inv}`, amountCents: 1234, currency: "EUR", payee: "PAYEE-1", ...over });
/** Requested, approved by the operator, token claimed. */
async function approved(key, params = pay()) {
  const r = await ask(key, params);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, "pending");
  assert.equal((await approve(r.body.id)).status, 200);
  const t = await claim(key, r.body.id);
  assert.equal(t.status, 200);
  return { id: r.body.id, token: t.body.token, params };
}

try {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error(`server exited: ${serverOut.slice(-500)}`);
    if (i > 120) throw new Error("server did not start within 60s");
    if (await fetch(`${URL_}/api/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const login = await call("POST", "/api/operator/session", { body: { token: ADMIN } });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];

  const agents = [];
  for (const name of ["Fake Payer", "Fake Other", "Fake Flooder"]) {
    const r = await call("POST", "/api/v1/agents", { op: true, body: { name, model: "fake-model", provider: "Anthropic" } });
    assert.equal(r.status, 201);
    agents.push({ id: r.body.agent.id, key: r.body.apiKey });
  }
  const [A, B, C] = agents;

  await step("unauthorized: an agent with no policy is denied, and executing without an authorization is blocked", async () => {
    const r = await ask(A.key, pay());
    assert.equal(r.status, 403);
    assert.equal(r.body.reason, "no_policy");
    const x = await run(A.key, r.body.id, `tend_az_${"a".repeat(43)}`, pay());
    assert.equal(x.status, 403);
    assert.equal((await run(A.key, "az_doesnotexist", `tend_az_${"a".repeat(43)}`, pay())).status, 404);
    assert.equal((await call("POST", "/api/v1/gateway/execute", { body: { authorizationId: r.body.id, tool: "pay_invoice", params: pay() } })).status, 401, "no agent key");
    assert.equal((await gwLog(A.id)).filter((t) => t.outcome === "success").length, 0);
  });

  for (const ag of [A, B, C]) {
    const p = await call("POST", `/api/v1/agents/${ag.id}/policy`, { op: true, body: { rules: [{ tool: "pay_invoice", action: "execute", effect: "approve" }] } });
    assert.equal(p.status, 200);
  }

  await step("pending: nothing can run and no token exists until a human approves", async () => {
    const r = await ask(A.key, pay());
    assert.equal(r.body.status, "pending");
    assert.equal(r.body.detail, "EUR 12.34 to Fake Supplier GmbH (PAYEE-1)", "the person approves what the gateway derived");
    assert.equal((await claim(A.key, r.body.id)).status, 202);
    assert.equal((await run(A.key, r.body.id, `tend_az_${"a".repeat(43)}`, pay())).status, 403);
  });

  let first;
  await step("human-approved: executes exactly once and returns only the allowlisted result", async () => {
    first = await approved(A.key);
    const x = await run(A.key, first.id, first.token, first.params);
    assert.equal(x.status, 200, JSON.stringify(x.body));
    assert.equal(x.body.executed, true);
    assert.deepEqual(Object.keys(x.body.result).sort(), ["paymentId", "status"]);
    assert.match(x.body.result.paymentId, /^pay_/);
    const log = (await gwLog(A.id)).filter((t) => t.outcome === "success");
    assert.equal(log.length, 1);
  });

  await step("replay: the same authorization cannot execute again, sequentially or concurrently", async () => {
    const again = await run(A.key, first.id, first.token, first.params);
    assert.equal(again.status, 409);
    assert.equal(again.body.error, "already_consumed");
    const a = await approved(A.key);
    const all = await Promise.all(Array.from({ length: 5 }, () => run(A.key, a.id, a.token, a.params)));
    assert.equal(all.filter((r) => r.status === 200).length, 1, all.map((r) => r.status).join(","));
    assert.equal((await gwLog(A.id)).filter((t) => t.outcome === "success").length, 2, "two authorizations, two executions");
  });

  await step("parameter mismatch: any change to amount, payee, currency or invoice is refused", async () => {
    const a = await approved(A.key);
    for (const change of [{ amountCents: 99_999 }, { payee: "PAYEE-2" }]) {
      const r = await run(A.key, a.id, a.token, { ...a.params, ...change });
      assert.equal(r.status, 403);
      assert.equal(r.body.error, "mismatch");
    }
    assert.equal((await run(A.key, a.id, a.token, a.params)).status, 200, "refused attempts did not spend it");
  });

  await step("identity: another agent cannot execute this agent's authorization", async () => {
    const a = await approved(A.key);
    assert.equal((await run(B.key, a.id, a.token, a.params)).status, 404);
  });

  await step("strict input: unknown tools, URLs, commands, coerced values and oversized bodies are refused", async () => {
    // On agent B: each agent may make 30 gateway calls a minute, and A has used most of its share.
    assert.equal((await ask(B.key, { command: "ls" }, "shell")).status, 404);
    for (const params of [{ ...pay(), url: "https://evil.example" }, { ...pay(), command: "id" }, pay({ payee: "DE89370400440532013000" }), pay({ amountCents: "1" }), pay({ amountCents: 1.5 })]) {
      const r = await ask(B.key, params);
      assert.equal(r.status, 422, JSON.stringify(params));
      assert.equal(r.body.error, "invalid_params");
    }
    const big = await call("POST", "/api/v1/gateway/requests", { key: B.key, raw: JSON.stringify({ tool: "pay_invoice", params: pay(), pad: "x".repeat(5_000) }) });
    assert.equal(big.status, 413);
  });

  await step("failure handling: a hanging tool times out (502, outcome unknown) and the authorization cannot be retried", async () => {
    const a = await approved(B.key, pay({ invoice: "INV-504" }));
    const t = Date.now();
    const r = await run(B.key, a.id, a.token, a.params);
    assert.equal(r.status, 502);
    assert.equal(r.body.reason, "timeout");
    assert.ok(Date.now() - t < 6_000);
    assert.equal((await run(B.key, a.id, a.token, a.params)).status, 409);
  });

  await step("rate limit: an agent flooding the gateway gets 429", async () => {
    const codes = [];
    // 62 calls: even if they straddle a minute boundary, one window sees more than 30.
    for (let i = 0; i < 62; i++) codes.push((await ask(C.key, { bad: true })).status);
    assert.ok(codes.includes(429), codes.join(","));
    assert.ok(codes.slice(0, 25).every((s) => s === 422));
  });

  await step("expiration: a token used after its 60 seconds is refused and nothing runs", async () => {
    const a = await approved(B.key);
    await new Promise((r) => setTimeout(r, 61_000));
    const r = await run(B.key, a.id, a.token, a.params);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "token_expired");
    assert.equal((await gwLog(B.id)).filter((t) => t.outcome === "success").length, 0);
  });

  await step("secrets: the gateway credential, admin token and tokens never appear in any response or server output", async () => {
    const all = seen.join("\n");
    assert.equal(all.includes(GW_KEY), false, "gateway credential leaked to a response");
    assert.equal(serverOut.includes(GW_KEY), false, "gateway credential leaked to server logs");
    assert.equal(all.includes(ADMIN), false, "admin token leaked");
    assert.equal(/tend_az_[A-Za-z0-9_-]{43}/.test(all.replaceAll(/tend_az_a{43}/g, "")), false, "token leaked");
    assert.equal(/token_hash|fingerprint|"debug"/.test(all), false, "internal field leaked");
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
