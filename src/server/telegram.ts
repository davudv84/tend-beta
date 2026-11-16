// The Telegram bot: linking a chat to a TEND account, the messages an approval is shown as, and what the bot does with what Telegram sends
// it (the webhook, app/api/telegram/webhook). Sending approval messages out is the notifier's business (notify/channels/telegram.ts).
//
// Rules this file keeps:
//  - Nothing Telegram sends is believed until the webhook's secret header matched (telegramSecretOk, checked by the route on every request).
//  - A chat is linked to an account only with a token that account asked for while signed in: single use, 15 minutes, stored as SHA-256.
//  - A button press decides nothing by itself. The Telegram user it came from must be linked to an account, the press must come from the
//    linked private chat, and the decision then goes through resolveApproval like every other channel: that account's own workspace only,
//    once only, never past expiry, and never an approval of a high-risk request.
//  - The bot token is never logged, put in an error or sent anywhere but Telegram.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DICTS } from "../i18n/index.ts";
import { resolveApproval, APPROVAL_ID, type ApprovalView, type Decision } from "./approvals.ts";
import { config } from "./config.ts";
import type { DB, Q } from "./db.ts";
import { HttpError, readJson } from "./http.ts";
import { spend } from "./limits.ts";
import { audit } from "./session.ts";

export const LINK_TTL = 15 * 60_000;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const dict = (locale: string | null | undefined) => DICTS[locale === "de" ? "de" : "en"].notify.telegram;
const localeOf = (code: unknown) => (typeof code === "string" && code.toLowerCase().startsWith("de") ? "de" : "en");

// ---- the Bot API -------------------------------------------------------------------------------------

export type TgResult<T> = { ok: true; result: T } | { ok: false; status: number; description: string };

/** One Bot API call. Never throws; a failure says the HTTP status and Telegram's description, never the address (it contains the token). */
export async function tg<T = unknown>(method: string, body: object): Promise<TgResult<T>> {
  const c = config.telegram;
  if (!c) return { ok: false, status: 0, description: "Telegram is not configured" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${c.token}/${method}`, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(8_000),
      headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: unknown } | null;
    if (res.ok && j?.ok) return { ok: true, result: j.result as T };
    return { ok: false, status: res.status, description: String(j?.description ?? "").slice(0, 200) };
  } catch {
    return { ok: false, status: 0, description: "no answer" };
  }
}

/** Whether a webhook request carries this server's secret (Telegram repeats it in X-Telegram-Bot-Api-Secret-Token). Constant time. */
export function telegramSecretOk(header: string | null) {
  const c = config.telegram;
  if (!c || !header) return false;
  return timingSafeEqual(createHash("sha256").update(header).digest(), createHash("sha256").update(c.secret).digest());
}

// ---- messages ----------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
type Markup = { inline_keyboard: ({ text: string; callback_data: string } | { text: string; url: string })[][] };
export interface TgMessage { text: string; parse_mode: "HTML"; link_preview_options: { is_disabled: true }; reply_markup: Markup }

/** A link into TEND for a button. Telegram only takes public https addresses, so without TEND_APP_URL (https) there is no button. */
const linkTo = (path: string) => (config.appUrl.startsWith("https://") ? `${config.appUrl}${path}` : null);

/** Who asks and for what: the part of the message that stays the same before and after the decision. A private chat, so the detail is shown. */
function body(locale: string, a: ApprovalView) {
  const t = dict(locale);
  return [
    t.wants(`<b>${esc(a.agentName)}</b>`, `<code>${esc(a.tool)} · ${esc(a.action)}</code>`),
    ...(a.resource ? [`${t.item}: <code>${esc(a.resource)}</code>`] : []),
    ...(a.detail ? [`<blockquote>${esc(a.detail)}</blockquote>`] : []),
  ].join("\n");
}

/** An approval that waits. Low risk: Approve and Deny buttons. High risk: no decision buttons, only the way to its page in TEND. */
export function approvalMessage(locale: string, a: ApprovalView, now: number): TgMessage {
  const t = dict(locale), url = linkTo(a.url), minutes = Math.max(1, Math.ceil((a.expiresAt - now) / 60_000));
  const open = url ? [[{ text: a.risk === "low" ? t.open : t.openConfirm, url }]] : [];
  return {
    text: `⚠️ <b>${t.heading}</b>\n${body(locale, a)}\n\n${a.risk === "low" ? t.lowRisk : t.highRisk}\n${t.expiresIn(minutes)}`,
    parse_mode: "HTML", link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [...(a.risk === "low" ? [[{ text: t.approve, callback_data: `approve:${a.id}` }, { text: t.deny, callback_data: `deny:${a.id}` }]] : []), ...open] },
  };
}

/** The same approval once it is settled: what became of it and who decided, and no buttons to decide with. */
export function resolvedMessage(locale: string, a: ApprovalView): TgMessage {
  const t = dict(locale), p = DICTS[locale === "de" ? "de" : "en"].notify.pushApproval, url = linkTo(a.url);
  const line = a.status === "approved" || a.status === "denied" ? t.outcome[a.status](esc(a.decidedBy ?? p.someone), p.via[a.via ?? "dashboard"])
    : a.status === "expired" ? t.outcome.expired : t.outcome.cancelled;
  return {
    text: `<b>${t.heading}</b>\n${body(locale, a)}\n\n${line}`,
    parse_mode: "HTML", link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: url ? [[{ text: t.open, url }]] : [] },
  };
}

// ---- linking a chat to an account --------------------------------------------------------------------

function needAccount(userId: string | null): asserts userId is string {
  if (!userId) throw new HttpError(409, "account_required", "Telegram is connected to an account. Sign in with your e-mail address.");
}

/** Whether Telegram is set up here and whether this account has a chat connected. Never the chat or Telegram id. */
export async function linkStatus(q: Q, userId: string | null) {
  const c = config.telegram;
  const link = userId ? await q.get<{ linked_at: number }>("SELECT linked_at FROM telegram_links WHERE user_id = ?", userId) : undefined;
  return { configured: !!c, account: !!userId, bot: c?.username ?? null, connected: !!link, linkedAt: link?.linked_at ?? null };
}

/**
 * A fresh link for this account to open in Telegram: https://t.me/<bot>?start=<token>. The token works once, for 15 minutes, and asking
 * again ends the previous one. Only its SHA-256 is stored.
 */
export async function createLink(db: DB, userId: string | null, now = Date.now()) {
  needAccount(userId);
  const c = config.telegram;
  if (!c) throw new HttpError(503, "telegram_not_configured", "Telegram is not set up on this TEND server.");
  const token = randomBytes(24).toString("base64url"); // 32 characters of [A-Za-z0-9_-], what a Telegram start parameter may hold
  await db.tx(async (q) => {
    await q.run("UPDATE user_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'telegram' AND used_at IS NULL", now, userId);
    await q.run("INSERT INTO user_tokens (hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, 'telegram', ?, ?)", sha(token), userId, now, now + LINK_TTL);
  });
  return { url: `https://t.me/${c.username}?start=${token}`, expiresAt: now + LINK_TTL };
}

/** Disconnects this account's chat (Settings). Unused link tokens stop working too. */
export async function unlink(db: DB, userId: string | null, now = Date.now()) {
  needAccount(userId);
  return db.tx(async (q) => {
    await q.run("UPDATE user_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'telegram' AND used_at IS NULL", now, userId);
    const n = await q.run("DELETE FROM telegram_links WHERE user_id = ?", userId);
    if (n) await audit(q, "telegram.unlinked", { userId, reason: "from settings", now });
    return n > 0;
  });
}

// ---- what Telegram sends us --------------------------------------------------------------------------

interface Update {
  message?: { text?: unknown; chat?: { id?: unknown; type?: unknown }; from?: { id?: unknown; language_code?: unknown } };
  callback_query?: { id?: unknown; data?: unknown; from?: { id?: unknown; language_code?: unknown }; message?: { message_id?: unknown; chat?: { id?: unknown } } };
}
const int = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const say = (chatId: number, text: string) => tg("sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true } });

/** `/start <token>`: connects this private chat to the account that asked for the token. The token is spent whatever happens next. */
async function link(db: DB, chatId: number, fromId: number, locale: string, token: string, now: number) {
  const t = dict(locale);
  const ok = await db.tx(async (q) => {
    const row = await q.get<{ user_id: string }>("UPDATE user_tokens SET used_at = ? WHERE hash = ? AND purpose = 'telegram' AND used_at IS NULL AND expires_at > ? RETURNING user_id", now, sha(token), now);
    if (!row) return false;
    if (!(await q.get("SELECT 1 FROM users WHERE id = ? AND disabled_at IS NULL AND read_only = 0", row.user_id))) return false;
    // One Telegram account answers for one TEND account: connecting it here disconnects it anywhere else.
    await q.run("DELETE FROM telegram_links WHERE telegram_user_id = ? AND user_id <> ?", fromId, row.user_id);
    await q.run(`INSERT INTO telegram_links (user_id, telegram_user_id, chat_id, locale, linked_at) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (user_id) DO UPDATE SET telegram_user_id = EXCLUDED.telegram_user_id, chat_id = EXCLUDED.chat_id, locale = EXCLUDED.locale, linked_at = EXCLUDED.linked_at`,
      row.user_id, fromId, chatId, locale, now);
    await audit(q, "telegram.linked", { userId: row.user_id, now });
    return true;
  });
  await say(chatId, ok ? t.connected : t.linkInvalid);
}

async function message(db: DB, m: NonNullable<Update["message"]>, now: number) {
  const chatId = m.chat?.id, fromId = m.from?.id;
  if (!int(chatId) || !int(fromId) || typeof m.text !== "string") return;
  const locale = localeOf(m.from?.language_code), t = dict(locale);
  const cmd = /^\/([a-z]+)(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?\s*$/.exec(m.text.slice(0, 200));
  // A group chat is not a place for approvals: everyone in it could read them and press the buttons.
  if (m.chat?.type !== "private") { if (cmd?.[1] === "start") await say(chatId, t.privateOnly); return; }
  if (cmd?.[1] === "start" && cmd[2] && /^[A-Za-z0-9_-]{16,64}$/.test(cmd[2])) return link(db, chatId, fromId, locale, cmd[2], now);
  if (cmd?.[1] === "disconnect" || cmd?.[1] === "stop") {
    const gone = await db.tx(async (q) => {
      const rows = await q.all<{ user_id: string }>("DELETE FROM telegram_links WHERE telegram_user_id = ? RETURNING user_id", fromId);
      for (const r of rows) await audit(q, "telegram.unlinked", { userId: r.user_id, reason: "from telegram", now });
      return rows.length > 0;
    });
    await say(chatId, gone ? t.disconnected : t.notConnected);
    return;
  }
  const linked = await db.get("SELECT 1 FROM telegram_links WHERE telegram_user_id = ?", fromId);
  await say(chatId, linked ? t.help : t.start);
}

/** A press on Approve or Deny under an approval message. */
async function callback(db: DB, cq: NonNullable<Update["callback_query"]>, now: number) {
  const fromId = cq.from?.id, chatId = cq.message?.chat?.id, messageId = cq.message?.message_id;
  if (typeof cq.id !== "string" || !int(fromId)) return;
  const answer = (text: string, alert = false) => tg("answerCallbackQuery", { callback_query_id: cq.id, text, show_alert: alert });
  const m = typeof cq.data === "string" ? /^(approve|deny):(.{1,40})$/.exec(cq.data) : null;
  // Who pressed: the Telegram user must be linked to an account that may act right now, and the press must come from the linked chat.
  const who = await db.get<{ user_id: string; chat_id: number; locale: string; workspace_id: string }>(
    `SELECT l.user_id, l.chat_id, l.locale, u.workspace_id FROM telegram_links l JOIN users u ON u.id = l.user_id
     WHERE l.telegram_user_id = ? AND u.disabled_at IS NULL AND u.read_only = 0 AND u.approved_at IS NOT NULL ${config.emailVerification ? "AND u.email_verified_at IS NOT NULL" : ""}`, fromId);
  const t = dict(who?.locale ?? localeOf(cq.from?.language_code));
  if (!who || !int(chatId) || chatId !== Number(who.chat_id)) return void (await answer(t.notConnected, true));
  if (!m || !APPROVAL_ID.test(m[2])) return void (await answer(t.toast.gone));
  let a: ApprovalView, changed: boolean;
  try {
    ({ approval: a, changed } = await resolveApproval(db, { id: m[2], decision: m[1] as Decision, via: "telegram", actor: { workspace: who.workspace_id, userId: who.user_id, by: `telegram:${fromId}` } }, now));
  } catch (e) {
    const code = e instanceof HttpError ? e.code : "";
    if (!code) console.error("[tend] a Telegram decision failed:", (e as Error).message);
    return void (await answer(code === "confirmation_required" ? t.toast.confirm : code === "approval_not_found" ? t.toast.gone : t.toast.failed, code === "confirmation_required"));
  }
  await answer(changed ? t.toast[a.status === "approved" ? "approved" : "denied"] : a.status === "expired" ? t.toast.expired : t.toast.already);
  // This message shows the outcome at once; the notifier updates every other place the approval was sent to (notify/index.ts).
  if (int(messageId)) {
    await db.run("DELETE FROM delivery_messages WHERE channel = 'telegram' AND target = ? AND message_id = ?", String(chatId), String(messageId));
    await tg("editMessageText", { chat_id: chatId, message_id: messageId, ...resolvedMessage(who.locale, a) });
  }
}

/**
 * One update from Telegram, already authenticated by the webhook's secret. Anything it does not understand is ignored. A Telegram user who
 * sends more than 30 updates a minute is ignored for the rest of that minute.
 */
export async function handleUpdate(db: DB, update: unknown, now = Date.now()) {
  if (!update || typeof update !== "object") return;
  const u = update as Update;
  const from = u.callback_query?.from?.id ?? u.message?.from?.id;
  if (!int(from) || !(await spend(db, `telegram:${from}`, 30, { now })).ok) return;
  if (u.callback_query) return callback(db, u.callback_query, now);
  if (u.message) return message(db, u.message, now);
}

/**
 * A request to the webhook address. The secret is checked first, on every request, before the body is read or the database is opened:
 * without it (or while Telegram is not set up here) the answer is 403 and nothing else happens. A request that passed never fails
 * afterwards, whatever it contained, so Telegram does not send it again.
 */
export async function receiveWebhook(req: Request, db: () => Promise<DB>, now = Date.now()) {
  if (!telegramSecretOk(req.headers.get("x-telegram-bot-api-secret-token"))) throw new HttpError(403, "forbidden", "Forbidden.");
  const update = await readJson(req, 256_000);
  try {
    await handleUpdate(await db(), update, now);
  } catch (e) {
    console.error("[tend] a Telegram update could not be handled:", (e as Error).message);
  }
}
