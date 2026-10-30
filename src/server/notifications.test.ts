// Notifications and the setup guide, against a real (in-memory) database and the real gateway: what creates a notification, what folds
// repeats into one, what resolves an approval, and that nothing crosses from one workspace to another.
import assert from "node:assert/strict";
import { test } from "node:test";
import { claimToken } from "./authz.ts";
import { memoryDb, type DB } from "./db.ts";
import { executeTool, requestExecution } from "./gateway.ts";
import { createTestNotification, listNotifications, markRead, pushEndpointOk, removeSubscription, saveSubscription, setPrefs } from "./notifications.ts";
import { onboardingView, shouldOnboard, updateOnboarding } from "./onboarding.ts";
import { decide, getAgent, insertAgent, insertEvent, registerAgent, setPolicy } from "./repo.ts";
import type { Session } from "./session.ts";

process.env.TEND_DEMO = "0";

const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

async function world() {
  const db = await memoryDb();
  for (const n of [1, 2]) {
    await db.run("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, 0)", `w${n}`, `W${n}`);
    await db.run("INSERT INTO users (id, email, password_hash, workspace_id, created_at, email_verified_at, approved_at, password_changed_at) VALUES (?, ?, 'x', ?, 0, 0, 0, 0)", `u${n}`, `u${n}@example.com`, `w${n}`);
  }
  const ana: Session = { id: "s1", userId: "u1", workspace: "w1", admin: false };
  const ben: Session = { id: "s2", userId: "u2", workspace: "w2", admin: false };
  return { db, ana, ben };
}

async function agentIn(db: DB, workspace: string, effect: "approve" | "allow" | "deny") {
  const { agent } = await registerAgent(db, { name: "Probe", model: "test", provider: "Custom" }, "s", workspace);
  await setPolicy(db, agent.id, [{ tool: "test_ping", action: "ping", effect }], "enforce");
  return (await getAgent(db, agent.id))!;
}
/** The guide for an account session (never the admin-token form). */
async function guide(db: DB, s: Session) {
  const v = await onboardingView(db, s);
  if (!v.available) throw new Error("no guide for this session");
  return v;
}
const ping = (db: DB, agent: Awaited<ReturnType<typeof agentIn>>, key?: string) => requestExecution(db, agent, { tool: "test_ping", params: { message: "hello" } }, key ?? null);

test("an approval request notifies its own workspace only, and answering it marks the notification read and resolved", async () => {
  const { db } = await world();
  const agent = await agentIn(db, "w1", "approve");
  const r = await ping(db, agent);
  let w1 = await listNotifications(db, "w1");
  assert.equal(w1.unread, 1);
  assert.deepEqual({ kind: w1.items[0].kind, tool: w1.items[0].tool, href: w1.items[0].href, resolved: w1.items[0].resolved }, { kind: "approval", tool: "test_ping", href: `/oversight?request=${r.view.id}`, resolved: false });
  assert.equal(w1.items[0].agentName, "Probe");
  assert.deepEqual(await listNotifications(db, "w2"), { unread: 0, items: [] }, "another workspace sees nothing");
  // A repeat of the same request (same idempotency key) is the same authorization: no second notification.
  await ping(db, agent, "same-1");
  await ping(db, agent, "same-1");
  assert.equal((await listNotifications(db, "w1")).items.length, 2);
  await decide(db, r.view.id, "approved", undefined, "s1");
  w1 = await listNotifications(db, "w1");
  const answered = w1.items.find((i) => i.href.endsWith(r.view.id))!;
  assert.equal(answered.resolved, true);
  assert.equal(answered.read, true);
  assert.equal(w1.unread, 1, "only the other, unanswered request is still unread");
  await db.close();
});

test("the same action blocked again and again is one notification with a count; a demo agent never notifies", async () => {
  const { db } = await world();
  const agent = await agentIn(db, "w1", "deny");
  for (let i = 0; i < 3; i++) assert.equal(await code(ping(db, agent)), "ok", "a policy denial is stored and answered, not thrown here");
  const { items, unread } = await listNotifications(db, "w1");
  assert.equal(items.length, 1);
  assert.deepEqual({ kind: items[0].kind, count: items[0].count, unread }, { kind: "blocked", count: 3, unread: 1 });
  const row = await db.get<{ push: string }>("SELECT push FROM notifications");
  assert.equal(row!.push, "none", "no browser is subscribed and push is not configured: nothing is queued");

  await db.tx(async (q) => {
    await insertAgent(q, { id: "demo-1", name: "Demo", model: "m", provider: "Custom", role: "r", description: "", status: "active", integrationEnabled: true, permissions: [], cadenceHours: 0, connectedAt: 0, origin: "demo", configVersion: 1, ackedVersion: 0, public: true }, undefined, undefined, "w1");
    await insertEvent(q, { agentId: "demo-1", type: "authorization.denied", actor: "system", data: { authorizationId: "az_x", tool: "pay_invoice", action: "pay" } });
  });
  assert.equal((await listNotifications(db, "w1")).items.length, 1, "the demo agent's event created nothing");
  await db.close();
});

test("marking read touches only the caller's workspace, and rejects malformed ids", async () => {
  const { db } = await world();
  await db.tx((q) => createTestNotification(q, "w1"));
  await db.tx((q) => createTestNotification(q, "w2"));
  const foreign = (await listNotifications(db, "w2")).items[0].id;
  assert.equal(await markRead(db, "w1", { ids: [foreign] }), 0, "an id from another workspace matches nothing");
  assert.equal((await listNotifications(db, "w2")).unread, 1);
  assert.equal(await code(markRead(db, "w1", { ids: ["nt_' OR 1=1 --"] })), "invalid_request");
  assert.equal(await code(markRead(db, "w1", {})), "invalid_request");
  assert.equal(await markRead(db, "w1", { all: true }), 1);
  assert.equal((await listNotifications(db, "w1")).unread, 0);
  assert.equal((await listNotifications(db, "w2")).unread, 1, "and all means all of mine");
  await db.close();
});

test("browser subscriptions: known push services only, keys checked, owner-only removal, and nothing without push credentials", async () => {
  const { db } = await world();
  for (const bad of ["http://fcm.googleapis.com/x", "https://169.254.169.254/latest", "https://localhost/x", "https://fcm.googleapis.com.evil.example/x", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "http://127.0.0.1:9/x", "javascript:alert(1)"])
    assert.equal(pushEndpointOk(bad), false, bad);
  for (const good of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/abc", "https://wns2-par02p.notify.windows.com/w/?token=abc"])
    assert.equal(pushEndpointOk(good), true, good);
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } };
  assert.equal(await code(saveSubscription(db, "u1", sub)), "push_not_configured", "without VAPID keys nothing is stored");
  const { publicKey, privateKey } = (await import("./push.ts")).newVapidKeys();
  Object.assign(process.env, { TEND_VAPID_PUBLIC_KEY: publicKey, TEND_VAPID_PRIVATE_KEY: privateKey, TEND_VAPID_SUBJECT: "mailto:ops@example.com" });
  try {
    assert.equal(await code(saveSubscription(db, null, sub)), "account_required", "an admin-token session has no account to subscribe");
    assert.equal(await code(saveSubscription(db, "u1", { ...sub, keys: { ...sub.keys, auth: "short" } })), "invalid_subscription");
    assert.equal(await code(saveSubscription(db, "u1", { ...sub, endpoint: "https://10.0.0.1/x" })), "invalid_subscription");
    await saveSubscription(db, "u1", sub);
    assert.equal(await removeSubscription(db, "u2", { endpoint: sub.endpoint }), 0, "another account cannot turn it off");
    assert.equal(await removeSubscription(db, "u1", { endpoint: sub.endpoint }), 1);
    assert.equal(await code(setPrefs(db, "u1", { approval: "yes" })), "invalid_request");
    assert.deepEqual(await setPrefs(db, "u1", { blocked: false }), { approval: true, blocked: false, alert: true });
  } finally {
    for (const k of ["TEND_VAPID_PUBLIC_KEY", "TEND_VAPID_PRIVATE_KEY", "TEND_VAPID_SUBJECT"]) delete process.env[k];
  }
  await db.close();
});

test("the setup guide: shown to new accounts, resumable, skippable, and completed only after TEND decided a real test action", async () => {
  const { db, ana, ben } = await world();
  assert.equal(await shouldOnboard(db, ana), true, "a new account with no agent");
  assert.equal(await shouldOnboard(db, { ...ana, userId: null }), false, "an admin-token session never");
  await updateOnboarding(db, ana, { action: "progress", step: "connect", integration: "claudeCode" });
  assert.equal((await guide(db, ana)).step, "connect", "resumes where it was left");
  assert.equal(await code(updateOnboarding(db, ana, { action: "progress", step: "done" })), "invalid_request", "done cannot be set directly");
  assert.equal(await code(updateOnboarding(db, ana, { action: "progress", step: "verify", integration: "<script>" })), "invalid_request");

  const foreign = await agentIn(db, "w2", "approve");
  assert.equal(await code(updateOnboarding(db, ana, { action: "progress", step: "verify", agentId: foreign.id })), "agent_not_found", "another workspace's agent is not there");
  const agent = await agentIn(db, "w1", "approve");
  await updateOnboarding(db, ana, { action: "progress", step: "test", agentId: agent.id });
  assert.equal(await code(updateOnboarding(db, ana, { action: "complete" })), "onboarding_incomplete", "nothing has run yet");

  // The real path: request, a person approves, the token is claimed, the gateway runs the tool.
  const r = await ping(db, agent);
  assert.equal((await guide(db, ana)).checks.test, null, "pending is not an outcome");
  await decide(db, r.view.id, "approved", undefined, ana.id);
  const claimed = (await claimToken(db, agent, r.view.id)).view;
  assert.ok("token" in claimed);
  const token = claimed.token;
  await executeTool(db, agent, { authorizationId: r.view.id, token, tool: "test_ping", params: { message: "hello" } });
  const v = await guide(db, ana);
  assert.equal(v.checks.policy, "approve");
  assert.equal(v.checks.test?.outcome, "ran");
  const done = await updateOnboarding(db, ana, { action: "complete" });
  assert.ok(done.available && done.completedAt);
  assert.equal(await shouldOnboard(db, ana), false);

  // Ben has a connected agent from before the guide existed: not interrupted. Skipping and restarting are recorded.
  assert.equal(await shouldOnboard(db, ben), false);
  await updateOnboarding(db, ben, { action: "restart" });
  assert.equal(await shouldOnboard(db, ben), true);
  await updateOnboarding(db, ben, { action: "skip" });
  assert.equal(await shouldOnboard(db, ben), false);
  assert.ok((await onboardingView(db, ben)).available);
  await db.close();
});

test("a policy block counts as TEND controlling the test, and a rejected request too", async () => {
  const { db, ana } = await world();
  const agent = await agentIn(db, "w1", "deny");
  await updateOnboarding(db, ana, { action: "progress", step: "test", agentId: agent.id });
  await ping(db, agent);
  assert.equal((await guide(db, ana)).checks.test?.outcome, "blocked");
  await setPolicy(db, agent.id, [{ tool: "test_ping", action: "ping", effect: "approve" }], "enforce");
  const r = await ping(db, agent);
  await decide(db, r.view.id, "rejected", undefined, ana.id);
  assert.equal((await guide(db, ana)).checks.test?.outcome, "rejected");
  await db.close();
});
