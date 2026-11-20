// Security monitoring (src/server/security-events.ts): redaction, alert thresholds and de-duplication, events from the real code paths, and
// delivery of an alert to a webhook over real HTTP (a local receiver on this machine).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { passwordSignIn, register } from "./accounts.ts";
import { memoryDb } from "./db.ts";
import { route, HttpError } from "./http.ts";
import { deliverAlert, redact, securityEvent, _testHooks, type Alert } from "./security-events.ts";

process.env.TEND_ADMIN_TOKEN = "t".repeat(8) + "0123456789abcdefghijklmnop";
process.env.TEND_TRUSTED_PROXY = "1";
delete process.env.TEND_ACCOUNTS;
const capture = () => { const lines: Record<string, unknown>[] = []; const sent: Alert[] = []; _testHooks({ sink: (l) => lines.push(JSON.parse(l)), deliver: async (a) => { sent.push(a); } }); return { lines, sent }; };

test("MON-1 redaction: secrets are dropped, identities hashed, addresses cut to their network, agent keys masked", () => {
  const r = redact({ password: "hunter2", token: "abc", apiKey: "tend_sk_x", cookie: "c", code: "123456", email: "a@example.com", account: "u_1", client: "203.0.113.77", note: "used tend_sk_AAAAAAAAAAAAAAAA here", n: 3 });
  assert.deepEqual(Object.keys(r).sort(), ["account", "client", "email", "n", "note"]);
  assert.match(String(r.email), /^h:[0-9a-f]{8}$/);
  assert.match(String(r.account), /^h:[0-9a-f]{8}$/);
  assert.equal(r.client, "203.0.113.0/24");
  assert.equal(r.note, "used tend_sk_… here");
  assert.equal(redact({ client: "2001:db8:1:2::5" }).client, "2001:db8:1::/48");
});

test("MON-2 thresholds raise one alert per rule and key, not one per event; below the threshold nothing; windows expire", () => {
  const { lines, sent } = capture();
  const t0 = 1_000_000_000_000;
  for (let i = 0; i < 24; i++) securityEvent("signin.failed", { client: "10.0.0.1" }, t0 + i);
  assert.equal(sent.length, 0, "24 failures: under the threshold of 25");
  for (let i = 0; i < 40; i++) securityEvent("signin.failed", { client: "10.0.0.1" }, t0 + 100 + i);
  assert.deepEqual(sent.map((a) => [a.rule, a.severity]), [["auth_failures", "high"]], "exactly one alert while it goes on");
  assert.equal(lines.filter((l) => l.tend === "security").length, 64, "every event is still a log line");
  // an hour later, with the window empty, the same number of failures spread over time stays quiet
  for (let i = 0; i < 30; i++) securityEvent("signin.failed", {}, t0 + 3_600_000 + i * 20_000);
  assert.equal(sent.length, 1, "30 failures over 10 minutes never put 25 in one 5-minute window");
  // critical rules fire on the first event
  securityEvent("isolation.failed", { reason: "x" }, t0);
  securityEvent("audit.failed", { reason: "y" }, t0);
  assert.deepEqual(sent.slice(1).map((a) => a.rule), ["tenant_isolation_failure", "audit_integrity"]);
  _testHooks(null);
});

test("MON-3 the real code paths emit events: wrong passwords (per account), refused operator requests, enforcement errors", async () => {
  const { lines, sent } = capture();
  const db = await memoryDb();
  const req = () => new Request("http://tend.test/api/account/sign-in", { method: "POST", headers: { host: "tend.test", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.1` } });
  await register(db, req(), { email: "mon3@example.com", password: "correct horse battery" });
  for (let i = 0; i < 10; i++) await passwordSignIn(db, req(), { email: "mon3@example.com", password: "wrong password " + i }).catch(() => {});
  const failed = lines.filter((l) => l.kind === "signin.failed");
  assert.equal(failed.length, 10);
  assert.ok(!JSON.stringify(failed).includes("mon3@example.com") && !JSON.stringify(failed).includes("wrong password"), "neither the address nor the password is logged");
  assert.ok(sent.some((a) => a.rule === "auth_failures_account"), "10 failures on one account: alert");
  const denied = route(async () => { throw new HttpError(404, "agent_not_found", "No such agent."); });
  for (let i = 0; i < 30; i++) await denied(new Request("http://tend.test/api/v1/agents/ag_abc123/policy", { headers: { "x-forwarded-for": "10.7.7.7" } }), {});
  assert.ok(sent.some((a) => a.rule === "repeated_denials"), "30 'not found' answers to one address: probing alert");
  const crash = route(async () => { throw new Error("boom"); });
  const saved = console.error; console.error = () => {};
  try { for (let i = 0; i < 3; i++) await crash(new Request("http://tend.test/api/v1/authorizations"), {}); } finally { console.error = saved; }
  assert.ok(sent.some((a) => a.rule === "enforcement_error"));
  _testHooks(null);
});

test("MON-4 delivery: an alert reaches a webhook over HTTP with only the alert in the body; a failing receiver is logged, never thrown", async () => {
  const got: { body: Record<string, unknown>; ua?: string }[] = [];
  let status = 204;
  const srv = createServer((rq, rs) => { let b = ""; rq.on("data", (c) => (b += c)); rq.on("end", () => { got.push({ body: JSON.parse(b), ua: rq.headers["user-agent"] }); rs.statusCode = status; rs.end(); }); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/hook`;
  const { lines } = capture();
  try {
    const alert: Alert = { rule: "audit_integrity", severity: "critical", count: 1, windowSeconds: 3600, summary: "The audit log hash chain did not verify", at: 1 };
    await deliverAlert(alert, url);
    assert.equal(got.length, 1);
    assert.equal(got[0].body.rule, "audit_integrity");
    assert.equal(got[0].body.source, "tend");
    assert.equal(got[0].ua, "TEND-alerts");
    assert.deepEqual(Object.keys(got[0].body).sort(), ["at", "count", "rule", "severity", "source", "summary", "windowSeconds"].sort().concat(got[0].body.service ? ["service"] : []).sort());
    status = 500;
    await deliverAlert(alert, url);
    assert.ok(lines.some((l) => l.kind === "alert.delivery_failed"), "a refused delivery is itself logged");
    await deliverAlert(alert, "http://127.0.0.1:1/nothing-listens").catch(() => "thrown");
  } finally { srv.close(); _testHooks(null); }
});
