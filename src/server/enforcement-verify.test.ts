// Independent verification of TEND's authorization guarantees (SECURITY-VERIFICATION.md, phase 2). Written from the documented guarantees
// and the public functions, not from authz.test.ts: it uses its own setup, injects the clock to cross every expiry, and attacks from the
// outside (revoked/rotated keys, pauses, concurrency, a failing audit write). Self-authored: it is evidence, not third-party validation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { claimToken, consumeAuthorization, MAX_PENDING, requestAuthorization, spendApproved, TTL } from "./authz.ts";
import { verifyAudit } from "./audit-chain.ts";
import { newKey } from "./auth.ts";
import { memoryDb } from "./db.ts";
import { HttpError } from "./http.ts";
import { agentByKey, control, decide, MAX_AGENTS_PER_WORKSPACE, registerAgent, revokeKey, rotateKey, setPolicy } from "./repo.ts";

const PAY = { tool: "wire", action: "send", resource: "ACC-1", detail: "EUR 5.00 to X" };
const RULES = [{ tool: "wire", action: "send", effect: "approve" }, { tool: "doc", action: "read", effect: "allow" }];

async function world() {
  const db = await memoryDb();
  const { agent, apiKey } = await registerAgent(db, { name: "Probe", model: "m", provider: "Custom" });
  await setPolicy(db, agent.id, RULES, "enforce");
  const as = async (key = apiKey) => (await agentByKey(db, key))!; // what authAgent hands the routes: looked up by key, before the transaction
  return { db, agent: await as(), apiKey, as };
}
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { if (e instanceof HttpError) return e.code; throw e; } };
const status = (db: Awaited<ReturnType<typeof memoryDb>>, id: string) => db.get<{ status: string }>("SELECT status FROM authorizations WHERE id = ?", id).then((r) => r?.status);

test("EV-1 an unanswered request expires and can then neither be approved nor yield a token", async () => {
  const { db, agent } = await world();
  const t0 = 1_000_000;
  const { view } = await requestAuthorization(db, agent, PAY, null, t0);
  assert.equal(view.status, "pending");
  assert.notEqual(await code(decide(db, view.id, "approved", undefined, undefined, t0 + TTL.request + 1)), "OK", "a decision after expiry is refused");
  assert.notEqual(await code(claimToken(db, agent, view.id, t0 + TTL.request + 1)), "OK");
  assert.equal(await status(db, view.id), "expired");
});

test("EV-2 an approval nobody used in time stops working, both flows, and the action is never authorized", async () => {
  const { db, agent } = await world();
  const t0 = 2_000_000;
  const a = (await requestAuthorization(db, agent, PAY, null, t0)).view, b = (await requestAuthorization(db, agent, { ...PAY, resource: "ACC-2" }, null, t0)).view;
  await decide(db, a.id, "approved", undefined, undefined, t0 + 1_000);
  await decide(db, b.id, "approved", undefined, undefined, t0 + 1_000);
  const tokB = (await claimToken(db, agent, b.id, t0 + 2_000)).view as unknown as { token: string };
  const late = t0 + 1_000 + TTL.approval + 1;
  assert.notEqual(await code(spendApproved(db, agent, a.id, PAY, late)), "OK");
  assert.notEqual(await code(consumeAuthorization(db, agent, b.id, { token: tokB.token, ...PAY, resource: "ACC-2" }, late)), "OK");
  assert.notEqual(await status(db, a.id), "consumed");
  assert.notEqual(await status(db, b.id), "consumed");
});

test("EV-3 a token is short-lived: valid inside its 60 s, refused after, even while the approval is still valid", async () => {
  const { db, agent } = await world();
  const t0 = 3_000_000;
  const { view } = await requestAuthorization(db, agent, PAY, null, t0);
  await decide(db, view.id, "approved", undefined, undefined, t0);
  const tok = ((await claimToken(db, agent, view.id, t0 + 1)).view as unknown as { token: string }).token;
  assert.equal(await code(consumeAuthorization(db, agent, view.id, { token: tok, ...PAY }, t0 + TTL.token + 1_000)), "token_expired");
  assert.equal(await status(db, view.id), "approved", "a refused late consume spends nothing");
  const tok2 = ((await claimToken(db, agent, view.id, t0 + TTL.token + 2_000)).view as unknown as { token: string }).token;
  assert.equal(await code(consumeAuthorization(db, agent, view.id, { token: tok, ...PAY }, t0 + TTL.token + 3_000)), "invalid_token", "re-claiming kills the older token");
  assert.equal(await code(consumeAuthorization(db, agent, view.id, { token: tok2, ...PAY }, t0 + TTL.token + 3_000)), "OK");
});

test("EV-4 revoking or rotating the key after approval ends everything that key had in flight", async () => {
  for (const how of ["revoke", "rotate"] as const) {
    const { db, agent, apiKey, as } = await world();
    const { view } = await requestAuthorization(db, agent, PAY, null);
    await decide(db, view.id, "approved");
    const tok = ((await claimToken(db, agent, view.id)).view as unknown as { token: string }).token;
    const newer = how === "revoke" ? (await revokeKey(db, agent.id), undefined) : (await rotateKey(db, agent.id)).apiKey;
    // The route resolved the agent by the old key before the revocation committed: the transaction must still refuse.
    assert.notEqual(await code(consumeAuthorization(db, agent, view.id, { token: tok, ...PAY })), "OK", how + " + token flow");
    assert.notEqual(await code(spendApproved(db, agent, view.id, PAY)), "OK", how + " + spend flow");
    assert.equal(await agentByKey(db, apiKey), undefined, "the old key no longer authenticates");
    if (newer) assert.notEqual(await code(spendApproved(db, await as(newer), view.id, PAY)), "OK", "the new key cannot pick up what the old key started");
    assert.notEqual(await status(db, view.id), "consumed");
  }
});

test("EV-5 pausing or disabling the agent after approval stops the spend", async () => {
  for (const action of ["pause", "disable"] as const) {
    const { db, agent } = await world();
    const { view } = await requestAuthorization(db, agent, PAY, null);
    await decide(db, view.id, "approved");
    await control(db, agent.id, action);
    assert.notEqual(await code(spendApproved(db, agent, view.id, PAY)), "OK", action);
  }
});

test("EV-6 a flood of parallel requests cannot leave more than MAX_PENDING waiting, and nothing is authorized without a person", async () => {
  const { db, agent } = await world();
  const out = await Promise.all(Array.from({ length: MAX_PENDING * 3 }, (_, i) => code(requestAuthorization(db, agent, { ...PAY, resource: `ACC-${i}` }, null, undefined, { spend: true }))));
  const pending = (await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM authorizations WHERE status = 'pending'"))!.n;
  assert.ok(pending <= MAX_PENDING, `pending=${pending}`);
  assert.equal((await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM authorizations WHERE status IN ('approved','consumed')"))!.n, 0);
  assert.ok(out.includes("too_many_pending"));
});

test("EV-7 racing approve, reject, cancel and spend: consumed only if a person approved and nobody cancelled first, and at most once", async () => {
  for (let round = 0; round < 15; round++) {
    const { db, agent } = await world();
    const { view } = await requestAuthorization(db, agent, PAY, null);
    const res = await Promise.allSettled([
      decide(db, view.id, "approved"), decide(db, view.id, "rejected"),
      ...Array.from({ length: 4 }, () => spendApproved(db, agent, view.id, PAY)),
      import("./authz.ts").then((m) => m.cancelAuthorization(db, agent, view.id)),
    ]);
    const spends = res.slice(2, 6).filter((r) => r.status === "fulfilled").length;
    const final = (await status(db, view.id))!;
    assert.ok(spends <= 1, `round ${round}: spent ${spends}x`);
    const decided = (await db.get<{ status: string }>("SELECT status FROM reviews WHERE id = ?", view.id))!.status;
    if (spends === 1) assert.equal(final, "consumed"), assert.equal(decided, "approved", "consumed requires an approval");
    if (final === "consumed") assert.equal(spends, 1);
    assert.ok(["consumed", "rejected", "cancelled", "approved", "pending"].includes(final));
  }
});

test("EV-8 the audit write and the authorization are one transaction: if the log cannot be written, nothing is authorized", async () => {
  const { db, agent } = await world();
  const { view } = await requestAuthorization(db, agent, PAY, null);
  await decide(db, view.id, "approved");
  await db.exec(`CREATE FUNCTION rt_block() RETURNS trigger AS $$ BEGIN IF NEW.type = 'authorization.consumed' THEN RAISE EXCEPTION 'audit write refused'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
                 CREATE TRIGGER rt_block_t BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION rt_block();`);
  await assert.rejects(spendApproved(db, agent, view.id, PAY));
  assert.equal(await status(db, view.id), "approved", "not consumed, so the caller was never told yes");
  const tok = ((await claimToken(db, agent, view.id)).view as unknown as { token: string }).token;
  await assert.rejects(consumeAuthorization(db, agent, view.id, { token: tok, ...PAY }));
  assert.equal(await status(db, view.id), "approved");
  await db.exec("DROP TRIGGER rt_block_t ON events");
  assert.equal(await code(spendApproved(db, agent, view.id, PAY)), "OK", "and works again once the log is writable");
});

test("EV-9 the audit trail says what happened: who asked, who decided, what was authorized, every refusal, and the chain verifies", async () => {
  const { db, agent } = await world();
  assert.equal((await requestAuthorization(db, agent, { tool: "wipe", action: "run" }, null)).view.status, "denied"); // no rule: denied and recorded
  const { view } = await requestAuthorization(db, agent, PAY, null);
  await decide(db, view.id, "approved", "ok by Sam", "operator-1");
  assert.equal(await code(spendApproved(db, agent, view.id, { ...PAY, detail: "EUR 5000.00 to X" })), "mismatch");
  await spendApproved(db, agent, view.id, PAY);
  assert.equal(await code(spendApproved(db, agent, view.id, PAY)), "already_consumed");
  const ev = (await db.all<{ type: string; actor: string; data: string }>("SELECT type, actor, data FROM events ORDER BY seq")).map((e) => ({ ...e, data: JSON.parse(e.data) }));
  const seq = ev.map((e) => e.type).filter((t) => t.startsWith("authorization.") || t === "review.decided" || t === "alert.raised");
  assert.deepEqual(seq, ["authorization.denied", "authorization.requested", "review.decided", "alert.raised", "authorization.consumed", "alert.raised"]);
  assert.equal(ev.find((e) => e.type === "authorization.denied")!.data.reason, "no_policy");
  const d = ev.find((e) => e.type === "review.decided")!;
  assert.deepEqual([d.actor, d.data.status, d.data.by], ["human", "approved", "operator-1"]);
  const c = ev.find((e) => e.type === "authorization.consumed")!;
  assert.deepEqual([c.actor, c.data.tool, c.data.detail], ["system", "wire", "EUR 5.00 to X"], "the log shows what was approved, not what was attempted");
  assert.deepEqual(ev.filter((e) => e.type === "alert.raised").map((e) => e.data.reason), ["parameters_differ", "replay"]);
  const res = await verifyAudit(db);
  assert.equal(res.ok, true);
  const text = JSON.stringify(ev);
  assert.ok(!text.includes("tend_az_") && !text.includes("tend_sk_"), "no token or key ever reaches the log");
});

test("EV-10 concurrent registrations cannot exceed the per-workspace agent limit", async () => {
  const db = await memoryDb();
  await db.run("INSERT INTO workspaces (id, name, created_at) VALUES ('wx', 'wx', 0)");
  const n = MAX_AGENTS_PER_WORKSPACE + 30;
  const out = await Promise.all(Array.from({ length: n }, (_, i) => code(registerAgent(db, { name: `a${i}`, model: "m", provider: "Custom" }, "u", "wx"))));
  const stored = (await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM agents WHERE workspace_id = 'wx'"))!.n;
  assert.equal(stored, MAX_AGENTS_PER_WORKSPACE);
  assert.equal(out.filter((x) => x === "OK").length, MAX_AGENTS_PER_WORKSPACE);
  assert.equal(out.filter((x) => x === "too_many_agents").length, 30);
});

test("EV-11 a key's hash is all that is stored, and a different tenant's key never resolves to this agent", async () => {
  const { db, agent, apiKey } = await world();
  const row = (await db.get<{ key_hash: string }>("SELECT key_hash FROM agents WHERE id = ?", agent.id))!;
  assert.ok(!JSON.stringify(await db.all("SELECT * FROM agents")).includes(apiKey), "the key itself is nowhere in the table");
  assert.match(row.key_hash, /^[0-9a-f]{64}$/);
  assert.equal(await agentByKey(db, newKey().key), undefined);
});

test("EV-12 numeric thresholds: no encoding a lenient tool would read as a large number gets past 'approve when amount > 50'", async () => {
  const { evaluate } = await import("./policy.ts");
  const rules = [{ tool: "refund", action: "issue", effect: "allow" }, { tool: "refund", action: "issue", effect: "approve", when: { amount: { gt: 50 } } }];
  const agent = { status: "active" as const, integrationEnabled: true, permissions: [] as string[] };
  const decide1 = (args: Record<string, unknown> | undefined) => evaluate(agent, rules, { tool: "refund", action: "issue", resource: null, detail: null, ...(args && { args }) }).effect;
  const encodings: unknown[] = [5000, 5000.0, 5e3, "5000", " 5000", "5000 ", "+5000", "5e3", "5E3", "0x1388", "0b1001110001000", "5000.0", "5_000", "5,000", "٥٠٠٠", "५०००", "Infinity", "1e999", Infinity, NaN, null, true, "true", [], [5000], ["5000"], [5000, 1], [1, 5000], { valueOf: 5000 }, { amount: 5000 }, { sha256: "x".repeat(64), length: 9 }, "5000\u0000", "5000abc", ""];
  for (const v of encodings) {
    const e = decide1({ amount: v });
    // a plain number at or below 50 is the only thing allowed through
    const plainSmall = typeof v === "number" && Number.isFinite(v) && v <= 50;
    assert.equal(e === "allow", plainSmall, `amount=${JSON.stringify(v)} → ${e}`);
  }
  for (const key of ["Amount", "amount ", " amount", "amounts", "amount​", "AMOUNT", "a.amount", "args.amount"]) assert.notEqual(decide1({ [key]: 5000 }), "allow", `key ${JSON.stringify(key)}`);
  assert.notEqual(decide1(undefined), "allow");
  assert.equal(decide1({ amount: 50 }), "allow");
  assert.equal(decide1({ amount: 50.01 }), "approve");
  // JSON.parse turns 1e999 into Infinity: it must not sail past either
  const parsed = JSON.parse('{"amount": 1e999}') as Record<string, unknown>;
  assert.notEqual(decide1(parsed), "allow");
});

test("EV-13 an agent key can expire: refused at the door and inside an in-flight authorization; rotating issues a fresh one; the server can cap the lifetime", async () => {
  const db = await memoryDb();
  const bad = [0, -1, 3651, 1.5, "7", [], {}, NaN];
  for (const keyExpiresInDays of bad) assert.equal(await code(registerAgent(db, { name: "x", model: "m", provider: "Custom", keyExpiresInDays })), "invalid_key_expiry", JSON.stringify(keyExpiresInDays));
  const { agent, apiKey, keyExpiresAt } = await registerAgent(db, { name: "Mortal", model: "m", provider: "Custom", keyExpiresInDays: 7 });
  assert.ok(keyExpiresAt! > Date.now() + 6.9 * 86_400_000 && keyExpiresAt! < Date.now() + 7.1 * 86_400_000);
  await setPolicy(db, agent.id, RULES, "enforce");
  const live = (await agentByKey(db, apiKey))!;
  const { view } = await requestAuthorization(db, live, PAY, null);
  await decide(db, view.id, "approved");
  await db.run("UPDATE agents SET key_expires_at = ? WHERE id = ?", Date.now() - 1, agent.id); // the week passes
  assert.equal(await agentByKey(db, apiKey), undefined, "an expired key no longer authenticates");
  assert.notEqual(await code(spendApproved(db, live, view.id, PAY)), "OK", "and what it had approved cannot be spent with it");
  assert.notEqual(await status(db, view.id), "consumed");
  const fresh = await rotateKey(db, agent.id, "op", 30);
  assert.ok(await agentByKey(db, fresh.apiKey), "rotating issues a working key");
  // the server-wide cap wins over a longer request
  process.env.TEND_KEY_MAX_AGE_DAYS = "2";
  try {
    const capped = await registerAgent(db, { name: "Capped", model: "m", provider: "Custom", keyExpiresInDays: 365 });
    assert.ok(capped.keyExpiresAt! < Date.now() + 2.1 * 86_400_000);
    const uncapped = await registerAgent(db, { name: "Capped too", model: "m", provider: "Custom" });
    assert.ok(uncapped.keyExpiresAt! < Date.now() + 2.1 * 86_400_000, "no request still means the cap, not forever");
  } finally { delete process.env.TEND_KEY_MAX_AGE_DAYS; }
  assert.equal((await registerAgent(db, { name: "Default", model: "m", provider: "Custom" })).keyExpiresAt, null, "default is unchanged: no expiry");
});

test("EV-14 the person deciding sees every argument the rules saw, with hidden characters made visible, ", async () => {
  const db = await memoryDb();
  const reg = await registerAgent(db, { name: "Args", model: "m", provider: "Custom" });
  await setPolicy(db, reg.agent.id, [{ tool: "refund", action: "issue", effect: "approve" }], "enforce");
  const a = (await agentByKey(db, reg.apiKey))!;
  const args = { amount: 5000, to: "ops@example.com‮.evil", note: "line1\nline2​", nested: { deep: [1, 2] }, long: "x".repeat(900) };
  const { view } = await requestAuthorization(db, a, { tool: "refund", action: "issue", detail: "refund EUR 5", args }, null);
  const ev = (await db.all<{ data: string }>("SELECT data FROM events WHERE type = 'authorization.requested'")).map((r) => JSON.parse(r.data)).find((d) => d.authorizationId === view.id)!;
  const text = ev.argsText as string;
  assert.match(text, /^amount: 5000$/m);
  assert.ok(text.includes("to: ops@example.com<U+202E>.evil"), text);
  assert.ok(text.includes("line1 ↵ line2<U+200B>"), "newlines and zero-width characters are shown, not acted on");
  assert.ok(text.includes('nested: {"deep":[1,2]}'));
  assert.ok(text.includes("(900 characters in all)"), "long values say so");
  assert.ok(!/[‮​]/.test(text), "no raw direction or zero-width character is left");
  assert.ok(text.length <= 1201);
});

test("EV-15 deny-list rules cannot be stepped around by values a consumer would read differently (traversal, display-name addresses, hidden characters)", async () => {
  const { evaluate } = await import("./policy.ts");
  const agent = { status: "active" as const, integrationEnabled: true, permissions: [] as string[] };
  const eff = (rules: unknown, tool: string, args: Record<string, unknown>) => evaluate(agent, rules, { tool, action: "x", resource: null, detail: null, args }).effect;
  const files = [{ tool: "read", action: "x", effect: "allow" }, { tool: "read", action: "x", effect: "deny", when: { path: { pathUnder: ["/etc", "/root/.ssh"] } } }];
  assert.equal(eff(files, "read", { path: "/etc/passwd" }), "deny");
  assert.equal(eff(files, "read", { path: "/srv/data/report.txt" }), "allow");
  for (const path of ["/srv/../etc/passwd", "/etc/../etc/shadow", "/srv/x/../../root/.ssh/id_rsa", "etc/passwd", "../etc/passwd", "\\etc\\passwd", "/etc\u0000/x", "/etc‮/x", "/srv/\\..\\etc", "./etc/passwd", ["/srv/a", "/srv/../etc/passwd"], ["/srv/a", "/etc/passwd"]])
    assert.equal(eff(files, "read", { path }), "deny", JSON.stringify(path));
  const mail = [{ tool: "send", action: "x", effect: "allow" }, { tool: "send", action: "x", effect: "deny", when: { to: { emailDomainIn: ["competitor.com"] } } }];
  assert.equal(eff(mail, "send", { to: "bob@competitor.com" }), "deny");
  assert.equal(eff(mail, "send", { to: "bob@example.com" }), "allow");
  for (const to of ["Bob <bob@competitor.com>", "bob@example.com, bob@competitor.com", "bob@competitor.com​", "\"bob@example.com\" <bob@competitor.com>", "bob@competitor.com (ok)", ["a@example.com", "b@competitor.com"], "bob@competitor.com\u0000.example.com"])
    assert.equal(eff(mail, "send", { to }), "deny", JSON.stringify(to));
  const cmd = [{ tool: "sh", action: "x", effect: "allow" }, { tool: "sh", action: "x", effect: "deny", when: { command: { contains: "rm -rf" } } }, { tool: "sh", action: "x", effect: "approve", when: { host: { equals: "prod" } } }];
  for (const command of ["rm\u0000 -rf /", "rm -rf​ /", "r​m -rf /", "rm -rf /"]) assert.equal(eff(cmd, "sh", { command }), "deny", JSON.stringify(command));
  assert.equal(eff(cmd, "sh", { command: "ls -la\n", host: "dev" }), "allow", "a trailing newline is ordinary and does not make a command unknown");
  assert.equal(eff(cmd, "sh", { command: "ls", host: "prod​" }), "approve", "a hidden character in 'prod' cannot step around the approve rule");
});

test("EV-16 agents of one workspace share a request budget, so one tenant cannot monopolise the database-wide write lock; other workspaces are unaffected", async () => {
  const { authAgent } = await import("./agent-auth.ts");
  const db = await memoryDb();
  await db.run("INSERT INTO workspaces (id, name, created_at) VALUES ('wa', 'wa', 0), ('wb', 'wb', 0)");
  process.env.TEND_WORKSPACE_RPM = "100"; process.env.TEND_AGENT_RPM = "10000";
  try {
    const a1 = await registerAgent(db, { name: "a1", model: "m", provider: "Custom" }, "u", "wa");
    const a2 = await registerAgent(db, { name: "a2", model: "m", provider: "Custom" }, "u", "wa");
    const b1 = await registerAgent(db, { name: "b1", model: "m", provider: "Custom" }, "u", "wb");
    const req = (key: string) => new Request("http://x/api/v1/agent/inbox", { headers: { authorization: `Bearer ${key}` } });
    const out = await Promise.all(Array.from({ length: 140 }, (_, i) => code(authAgent(db, req(i % 2 ? a1.apiKey : a2.apiKey)))));
    assert.ok(out.filter((x) => x === "OK").length <= 100, "no more than the workspace budget got through");
    assert.ok(out.includes("rate_limited"));
    assert.equal(await code(authAgent(db, req(b1.apiKey))), "OK", "another workspace is unaffected");
  } finally { delete process.env.TEND_WORKSPACE_RPM; delete process.env.TEND_AGENT_RPM; }
});

test("EV-17 SSRF: the only outbound URL an operator can make the server call (a push endpoint) is limited to the real push services", async () => {
  const { pushEndpointOk } = await import("./notifications.ts");
  const ok = ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/abc", "https://abc.notify.windows.com/w/?token=x"];
  const no = ["http://fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.com/x", "https://evil.com/fcm.googleapis.com", "https://fcm.googleapis.com@evil.com/x", "https://user:pw@fcm.googleapis.com/x",
    "https://169.254.169.254/latest/meta-data", "https://[::1]/", "https://127.0.0.1/", "https://localhost/", "https://fcm.googleapis.com:8443/x", "https://fcm.googleapis.com./x", "https://a.b.notify.windows.com/x",
    "https://x.notify.windows.com.evil.com/", "https://evilpush.apple.com/x", "file:///etc/passwd", "gopher://fcm.googleapis.com/", "https://fcm.googleapis.com/x#frag", "//fcm.googleapis.com/x", "", 5, null, "https://" + "a".repeat(1100)];
  for (const u of ok) assert.equal(pushEndpointOk(u), true, u);
  for (const u of no) assert.equal(pushEndpointOk(u), false, String(u));
});
