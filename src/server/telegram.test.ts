// The Telegram bot and the notifier's channels, against a real (in-memory) database. Telegram's Bot API and the browser push service are
// stand-ins inside this process (fetch is replaced), so the tests see exactly what TEND would send and nothing leaves the machine.
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, hkdfSync } from "node:crypto";
import { test } from "node:test";
import { getApproval, resolveApproval, type Actor } from "./approvals.ts";
import { requestAuthorization, sweepExpired, TTL } from "./authz.ts";
import { memoryDb, type DB } from "./db.ts";
import { saveSubscription } from "./notifications.ts";
import { flushNotifications, notifyResolved } from "./notify/index.ts";
import { newVapidKeys } from "./push.ts";
import { takeResolvedDue } from "./push-due.ts";
import { getAgent, registerAgent, setPolicy } from "./repo.ts";
import { createLink, LINK_TTL, linkStatus, receiveWebhook, telegramSecretOk, unlink } from "./telegram.ts";

process.env.TEND_DEMO = "0";
const TOKEN = "100000001:test-token-not-a-real-bot-token-000000", SECRET = "s3cret_s3cret_s3cret_s3cret_0123";
const TELEGRAM = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_USERNAME: "tend_test_bot", TEND_APP_URL: "https://tend.test" };
Object.assign(process.env, TELEGRAM);

// ---- stand-ins for Telegram and a push service ------------------------------------------------------------------
type Call = { method: string; body: Record<string, unknown> & { text?: string; chat_id?: number; message_id?: number; reply_markup?: { inline_keyboard: Record<string, string>[][] } } };
let calls: Call[] = [];
let pushed: Buffer[] = [];
let telegramDown = false, pushAnswer = 201, nextMessageId = 1000;
const PUSH_ENDPOINT = "http://127.0.0.1:9/push/one";
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(url);
  if (m) {
    assert.equal(m[1], TOKEN, "the bot token goes to Telegram and nowhere else");
    if (telegramDown) throw new Error("connect ECONNREFUSED");
    calls.push({ method: m[2], body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true, result: m[2] === "sendMessage" ? { message_id: ++nextMessageId } : true });
  }
  if (url === PUSH_ENDPOINT) {
    pushed.push(Buffer.from(init?.body as Uint8Array));
    return new Response(null, { status: pushAnswer });
  }
  throw new Error(`a request went somewhere unexpected: ${new URL(url).origin}`);
}) as typeof fetch;
const reset = () => { calls = []; pushed = []; telegramDown = false; pushAnswer = 201; takeResolvedDue(); };
const sent = (method: string) => calls.filter((c) => c.method === method);
const buttons = (c: Call) => (c.body.reply_markup?.inline_keyboard ?? []).flat();

// ---- a small world ------------------------------------------------------------------------------------------
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const EMAIL = { tool: "send_email", action: "send", resource: "client-1042", detail: "Email to client 1042, subject: Invoice <42> & more" };
const NOTE = { tool: "read_ticket", action: "read", resource: "ticket-7", detail: "Read ticket 7" };
const RULES = [{ tool: "send_email", action: "send", effect: "approve" }, { tool: "read_ticket", action: "read", effect: "approve", risk: "low" }];

async function world() {
  reset();
  const db = await memoryDb();
  for (const n of [1, 2]) {
    await db.run("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, 0)", `w${n}`, `W${n}`);
    await db.run("INSERT INTO users (id, email, password_hash, workspace_id, created_at, email_verified_at, approved_at, password_changed_at) VALUES (?, ?, 'x', ?, 0, 0, 0, 0)", `u${n}`, `u${n}@example.com`, `w${n}`);
  }
  const { agent: registered } = await registerAgent(db, { name: "Probe", model: "test", provider: "Custom" }, "s", "w1");
  await setPolicy(db, registered.id, RULES, "enforce");
  const agent = (await getAgent(db, registered.id))!;
  const ask = async (body: object, now?: number) => (await requestAuthorization(db, agent, body, null, now)).view.id;
  return { db, agent, ask, ana: { workspace: "w1", userId: "u1", by: "s1" } satisfies Actor };
}
/** A request as Telegram makes it. `db` must not be reached when the secret is wrong. */
const hook = (db: DB | null, update: unknown, secret: string | null = SECRET, now?: number) => receiveWebhook(
  new Request("https://tend.test/api/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", ...(secret !== null && { "x-telegram-bot-api-secret-token": secret }) }, body: JSON.stringify(update) }),
  async () => db ?? assert.fail("the database was opened for a request without the secret"), now);
const start = (token: string, from = 501, chat: { id: number; type: string } = { id: from, type: "private" }) => ({ message: { text: `/start ${token}`, chat, from: { id: from, language_code: "en" } } });
const press = (data: string, from = 501, chat = from, messageId = 1) => ({ callback_query: { id: `cb-${from}-${data}`, data, from: { id: from }, message: { message_id: messageId, chat: { id: chat } } } });
/** Links a Telegram account to a TEND account the way a person does: a link from Settings, then Start in the bot. */
async function connect(db: DB, userId: string, telegramId: number) {
  const { url } = await createLink(db, userId);
  await hook(db, start(new URL(url).searchParams.get("start")!, telegramId));
  assert.equal((await linkStatus(db, userId)).connected, true);
  reset();
}
const status = async (db: DB, id: string) => (await db.get<{ status: string }>("SELECT status FROM authorizations WHERE id = ?", id))!.status;

// ---- the webhook's secret -----------------------------------------------------------------------------------

test("the webhook refuses every request without the right secret with 403, before reading it or touching anything", async () => {
  reset();
  const update = start("x".repeat(32));
  for (const secret of [null, "", "wrong", SECRET.slice(0, -1), `${SECRET}x`, SECRET.toUpperCase()]) {
    const e = await hook(null, update, secret).catch((x) => x);
    assert.deepEqual({ status: e.status, code: e.code }, { status: 403, code: "forbidden" }, `secret ${JSON.stringify(secret)}`);
  }
  assert.equal(calls.length, 0, "nothing was sent to Telegram");
  assert.equal(telegramSecretOk(SECRET), true);
  // While Telegram is not set up on this server, even the "right" secret opens nothing.
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  try {
    assert.equal((await hook(null, update, SECRET).catch((x) => x)).status, 403);
    assert.equal((await hook(null, update, "").catch((x) => x)).status, 403);
  } finally {
    Object.assign(process.env, TELEGRAM);
  }
});

// ---- linking ------------------------------------------------------------------------------------------------

test("linking: a signed-in account gets a one-time link; /start with its token connects the private chat and answers ✅ TEND connected", async () => {
  const { db } = await world();
  assert.equal(await code(createLink(db, null)), "account_required", "the admin-token operator has no account to connect");
  const now = Date.now();
  const { url, expiresAt } = await createLink(db, "u1", now);
  const token = new URL(url).searchParams.get("start")!;
  assert.match(url, /^https:\/\/t\.me\/tend_test_bot\?start=[A-Za-z0-9_-]{32}$/);
  assert.equal(expiresAt, now + LINK_TTL);
  assert.equal(LINK_TTL, 15 * 60_000);
  const stored = await db.all<{ hash: string }>("SELECT hash FROM user_tokens WHERE purpose = 'telegram'");
  assert.ok(stored.length === 1 && stored[0].hash !== token && !stored[0].hash.includes(token), "only a hash of the token is stored");
  assert.deepEqual(await linkStatus(db, "u1"), { configured: true, account: true, bot: "tend_test_bot", connected: false, linkedAt: null });

  // In a group, nothing is connected: everyone there could read approvals and press the buttons.
  await hook(db, start(token, 501, { id: -100123, type: "group" }), SECRET, now);
  assert.equal((await linkStatus(db, "u1")).connected, false);
  assert.match(sent("sendMessage").at(-1)!.body.text!, /private chat/);

  await hook(db, start(token, 501), SECRET, now + 1000);
  assert.match(sent("sendMessage").at(-1)!.body.text!, /^✅ TEND connected/);
  assert.equal(sent("sendMessage").at(-1)!.body.chat_id, 501);
  assert.deepEqual(await db.get("SELECT user_id, telegram_user_id, chat_id FROM telegram_links"), { user_id: "u1", telegram_user_id: 501, chat_id: 501 });
  assert.equal((await linkStatus(db, "u1")).connected, true);
  assert.deepEqual((await db.all<{ type: string; user_id: string }>("SELECT type, user_id FROM auth_events WHERE type LIKE 'telegram.%'")), [{ type: "telegram.linked", user_id: "u1" }]);
  await db.close();
});

test("a link token works once and only for 15 minutes; a newer link ends the older one; a wrong token connects nothing", async () => {
  const { db } = await world();
  const now = Date.now();
  const tokenOf = async (user: string, at: number) => new URL((await createLink(db, user, at)).url).searchParams.get("start")!;
  const invalid = () => assert.match(sent("sendMessage").at(-1)!.body.text!, /expired or was already used/);

  const used = await tokenOf("u1", now);
  await hook(db, start(used, 501), SECRET, now);
  // The same token again, from someone else: spent.
  await hook(db, start(used, 666), SECRET, now + 1);
  invalid();
  assert.deepEqual((await db.all<{ telegram_user_id: number }>("SELECT telegram_user_id FROM telegram_links")).map((r) => r.telegram_user_id), [501]);

  const late = await tokenOf("u2", now);
  await hook(db, start(late, 502), SECRET, now + LINK_TTL + 1);
  invalid();
  const older = await tokenOf("u2", now), newer = await tokenOf("u2", now + 10);
  await hook(db, start(older, 502), SECRET, now + 20);
  invalid();
  await hook(db, start("A".repeat(32), 502), SECRET, now + 20);
  invalid();
  assert.equal((await linkStatus(db, "u2")).connected, false);
  await hook(db, start(newer, 502), SECRET, now + 30);
  assert.equal((await linkStatus(db, "u2")).connected, true);

  // /disconnect in the chat, and Disconnect in Settings, both end it.
  await hook(db, { message: { text: "/disconnect", chat: { id: 502, type: "private" }, from: { id: 502 } } }, SECRET, now + 40);
  assert.equal((await linkStatus(db, "u2")).connected, false);
  assert.match(sent("sendMessage").at(-1)!.body.text!, /^Disconnected/);
  assert.equal(await unlink(db, "u1"), true);
  assert.equal((await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM telegram_links"))!.n, 0);
  await db.close();
});

// ---- approvals in Telegram ------------------------------------------------------------------------------------

test("a new approval is sent to the connected chat: low risk with Approve/Deny buttons, high risk with only a button that opens its page", async () => {
  const { db, ask } = await world();
  await connect(db, "u1", 501);
  await connect(db, "u2", 502); // another workspace: must receive nothing
  const low = await ask(NOTE);
  assert.deepEqual((await flushNotifications(db)).channels, { telegram: { sent: 1, failed: 0 } });
  const lowMsg = sent("sendMessage")[0];
  assert.equal(lowMsg.body.chat_id, 501);
  assert.match(lowMsg.body.text!, /Approval needed/);
  assert.match(lowMsg.body.text!, /<b>Probe<\/b> wants to run <code>read_ticket · read<\/code>/);
  assert.match(lowMsg.body.text!, /Read ticket 7/, "a private chat shows the detail");
  assert.deepEqual(buttons(lowMsg), [
    { text: "✅ Approve", callback_data: `approve:${low}` }, { text: "❌ Deny", callback_data: `deny:${low}` }, { text: "Open in TEND", url: `https://tend.test/approvals/${low}` }]);

  const high = await ask(EMAIL);
  await flushNotifications(db);
  const highMsg = sent("sendMessage")[1];
  assert.deepEqual(buttons(highMsg), [{ text: "Open TEND to confirm", url: `https://tend.test/approvals/${high}` }], "no way to decide a high-risk approval from the chat");
  assert.match(highMsg.body.text!, /Invoice &lt;42&gt; &amp; more/, "what the agent wrote cannot inject markup");
  assert.equal(sent("sendMessage").length, 2, "nothing went to the other workspace's chat");
  await db.close();
});

test("a button press decides through resolveApproval as the linked account: recorded with its channel, answered, and the message shows who decided", async () => {
  const { db, ask } = await world();
  await connect(db, "u1", 501);
  const id = await ask(NOTE);
  await flushNotifications(db);
  const messageId = nextMessageId;
  reset();
  await hook(db, press(`approve:${id}`, 501, 501, messageId));
  const a = await getApproval(db, "w1", id);
  assert.deepEqual({ status: a.status, by: a.decidedBy, via: a.via }, { status: "approved", by: "u1@example.com", via: "telegram" });
  const d = JSON.parse((await db.get<{ data: string }>("SELECT data FROM events WHERE type = 'review.decided'"))!.data);
  assert.deepEqual({ by: d.by, userId: d.userId, via: d.via, authorizationId: d.authorizationId, status: d.status }, { by: "telegram:501", userId: "u1", via: "telegram", authorizationId: id, status: "approved" });
  assert.equal(sent("answerCallbackQuery")[0].body.text, "Approved");
  const edit = sent("editMessageText")[0];
  assert.deepEqual({ chat: edit.body.chat_id, message: edit.body.message_id }, { chat: 501, message: messageId });
  assert.match(edit.body.text!, /✅ Approved by u1@example\.com via Telegram/);
  assert.equal(buttons(edit).some((b) => "callback_data" in b), false, "no buttons left to decide with");

  // Pressed again (the other button, a stale copy of the message): nothing changes.
  reset();
  await hook(db, press(`deny:${id}`, 501, 501, messageId));
  assert.equal((await getApproval(db, "w1", id)).status, "approved");
  assert.equal(sent("answerCallbackQuery")[0].body.text, "This was already decided");
  assert.equal((await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM events WHERE type = 'review.decided'"))!.n, 1);
  await db.close();
});

test("a press decides nothing unless it comes from the linked account, in its linked chat, for an approval of its own workspace, and never approves high risk", async () => {
  const { db, ask } = await world();
  await connect(db, "u1", 501);
  await connect(db, "u2", 502);
  const low = await ask(NOTE), high = await ask(EMAIL);
  const answers = () => sent("answerCallbackQuery").map((c) => c.body.text);

  await hook(db, press(`approve:${low}`, 999)); // a Telegram account nobody linked
  await hook(db, press(`approve:${low}`, 502)); // linked, but to an account of another workspace
  await hook(db, press(`approve:${low}`, 501, 777)); // the linked person, from a chat that is not the linked one (a forwarded message, a group)
  await hook(db, press(`approve:${high}`, 501)); // a made-up button: the high-risk message never had one
  await hook(db, press("approve:az_'; DROP TABLE users; --", 501));
  await hook(db, press("launch:missiles", 501));
  assert.deepEqual(answers(), [
    "This Telegram account is not connected to TEND.", "This request no longer exists.", "This Telegram account is not connected to TEND.",
    "High risk: open TEND and confirm it there.", "This request no longer exists.", "This request no longer exists."]);
  assert.deepEqual([await status(db, low), await status(db, high)], ["pending", "pending"], "nothing was decided");
  assert.equal(sent("editMessageText").length, 0);

  // A disabled account's chat stops deciding at once.
  await db.run("UPDATE users SET disabled_at = 1 WHERE id = 'u1'");
  await hook(db, press(`approve:${low}`, 501));
  assert.equal(await status(db, low), "pending");
  await db.run("UPDATE users SET disabled_at = NULL WHERE id = 'u1'");
  // Denying is always allowed, also for high risk (the safe answer), and the rightful press finally approves the low one.
  await hook(db, press(`deny:${high}`, 501));
  await hook(db, press(`approve:${low}`, 501));
  assert.deepEqual([await status(db, low), await status(db, high)], ["approved", "rejected"]);
  await db.close();
});

test("decided elsewhere, or expired: the Telegram message is edited to say what became of it, once", async () => {
  const { db, ask, ana } = await world();
  await connect(db, "u1", 501);
  const t0 = Date.now();
  const a = await ask(NOTE, t0), b = await ask(EMAIL, t0);
  await flushNotifications(db, t0);
  const messageOf = async (id: string) => Number((await db.get<{ message_id: string }>("SELECT m.message_id FROM delivery_messages m JOIN notifications n ON n.id = m.notification_id WHERE n.subject = ? AND m.channel = 'telegram'", id))!.message_id);
  const msgA = await messageOf(a), msgB = await messageOf(b);
  reset();

  await resolveApproval(db, { id: a, decision: "approve", via: "dashboard", actor: ana }, t0 + 1000);
  // What the request wrapper does after the response (http.ts): every approval this request settled gets its messages updated.
  assert.deepEqual(takeResolvedDue(), [a]);
  await notifyResolved(db, a);
  assert.deepEqual(sent("editMessageText").map((c) => [c.body.message_id, /✅ Approved by u1@example\.com via the dashboard/.test(c.body.text!), buttons(c).some((x) => "callback_data" in x)]), [[msgA, true, false]]);
  await notifyResolved(db, a);
  assert.equal(sent("editMessageText").length, 1, "a second call finds nothing left to update");

  reset();
  await sweepExpired(db, t0 + TTL.request + 1);
  assert.deepEqual(takeResolvedDue(), [b]);
  await notifyResolved(db, b);
  assert.deepEqual(sent("editMessageText").map((c) => [c.body.message_id, /⌛ Expired/.test(c.body.text!)]), [[msgB, true]]);
  await db.close();
});

// ---- the notifier: channels side by side ----------------------------------------------------------------------

/** What a browser does with a push message (RFC 8291, the receiving side), so the test can read what would be shown. */
function decrypt(body: Buffer, uaPrivate: Buffer, auth: Buffer) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), record = body.subarray(21 + idlen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const ua = ecdh.getPublicKey();
  const ikm = Buffer.from(hkdfSync("sha256", ecdh.computeSecret(asPublic), auth, Buffer.concat([Buffer.from("WebPush: info\0"), ua, asPublic]), 32));
  const d = createDecipheriv("aes-128-gcm", Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16)), Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12)));
  d.setAuthTag(record.subarray(record.length - 16));
  return JSON.parse(Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]).subarray(0, -1).toString());
}

test("every connected channel gets a new approval, in parallel, and one channel failing does not stop the other", async () => {
  const keys = newVapidKeys();
  Object.assign(process.env, { NEXT_PUBLIC_VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:ops@example.com", TEND_PUSH_TEST_ENDPOINTS: "loopback" });
  try {
    const { db, ask, ana } = await world();
    await connect(db, "u1", 501);
    const browser = createECDH("prime256v1");
    browser.generateKeys();
    const auth = Buffer.alloc(16, 7);
    await saveSubscription(db, "u1", { endpoint: PUSH_ENDPOINT, keys: { p256dh: browser.getPublicKey().toString("base64url"), auth: auth.toString("base64url") }, locale: "en" });
    const read = (i: number) => decrypt(pushed[i], browser.getPrivateKey(), auth);

    // Both up: both deliver. The browser notification: the spec'd title, tag = approval id, agent and tool·action, never the detail.
    const low = await ask(NOTE);
    assert.deepEqual((await flushNotifications(db)).channels, { "web-push": { sent: 1, failed: 0 }, telegram: { sent: 1, failed: 0 } });
    const p = read(0);
    assert.deepEqual({ type: p.type, title: p.title, body: p.body, tag: p.tag, url: p.url, approvalId: p.approvalId, risk: p.risk }, { type: "approval", title: "⚠️ TEND: Approval needed", body: "Probe wants to run read_ticket · read", tag: low, url: `/approvals/${low}`, approvalId: low, risk: "low" });
    assert.deepEqual(p.actions, [{ action: "approve", title: "Approve" }, { action: "deny", title: "Deny" }]);
    assert.equal(JSON.stringify(p).includes("ticket 7"), false, "no detail on a lock screen");

    // Telegram is down: the browser is still told. High risk: no buttons in the browser notification either.
    reset();
    telegramDown = true;
    const high = await ask(EMAIL);
    assert.deepEqual((await flushNotifications(db)).channels, { "web-push": { sent: 1, failed: 0 }, telegram: { sent: 0, failed: 1 } });
    assert.deepEqual({ risk: read(0).risk, actions: read(0).actions, tag: read(0).tag }, { risk: "high", actions: [], tag: high });
    assert.equal(JSON.stringify(read(0)).includes("Invoice"), false);

    // The push service is failing: Telegram is still told.
    reset();
    pushAnswer = 500;
    await ask({ ...NOTE, resource: "ticket-8" });
    assert.deepEqual((await flushNotifications(db)).channels, { "web-push": { sent: 0, failed: 1 }, telegram: { sent: 1, failed: 0 } });

    // Decided through one channel: the browser's notification is replaced (same tag) with who decided and how.
    reset();
    await resolveApproval(db, { id: low, decision: "approve", via: "telegram", actor: { ...ana, by: "telegram:501" } });
    await notifyResolved(db, low);
    const r = read(0);
    assert.deepEqual({ type: r.type, tag: r.tag, title: r.title }, { type: "resolved", tag: low, title: "✅ TEND: approved" });
    assert.match(r.body, /Approved by u1@example\.com via Telegram/);
    assert.match(sent("editMessageText")[0].body.text!, /Approved by u1@example\.com via Telegram/);

    // A subscription the push service says is gone (410) is deleted.
    reset();
    pushAnswer = 410;
    await ask({ ...NOTE, resource: "ticket-9" });
    await flushNotifications(db);
    assert.equal((await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM push_subscriptions"))!.n, 0);
    await db.close();
  } finally {
    for (const k of ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "TEND_PUSH_TEST_ENDPOINTS"]) delete process.env[k];
  }
});

test("without Telegram's settings nothing is sent there and nothing is queued for it; the bot token never appears in a log line", async () => {
  const { db, ask } = await world();
  await connect(db, "u1", 501);
  const logged: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  try {
    telegramDown = true;
    await ask(NOTE);
    await flushNotifications(db);
    telegramDown = false;
    delete process.env.TELEGRAM_BOT_TOKEN;
    await ask(EMAIL);
    assert.equal((await db.get<{ push: string }>("SELECT push FROM notifications ORDER BY created_at DESC, id DESC LIMIT 1"))!.push, "none");
    assert.deepEqual(await flushNotifications(db), { configured: false, sent: 0, failed: 0, channels: {} });
    assert.equal(calls.length, 0);
  } finally {
    console.error = original;
    Object.assign(process.env, TELEGRAM);
  }
  assert.ok(logged.length > 0, "the failure was logged");
  assert.equal(logged.some((l) => l.includes(TOKEN) || l.includes(TOKEN.split(":")[1])), false);
  await db.close();
});
