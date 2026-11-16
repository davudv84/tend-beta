// Telegram: approval requests in a private chat with TEND's bot, for every account of the workspace that connected one (telegram.ts has the
// linking, the message text and what the bot does with a button press). Approvals only, plus the test from Settings.
import { DICTS } from "../../../i18n/index.ts";
import { config } from "../../config.ts";
import type { DB } from "../../db.ts";
import { approvalMessage, resolvedMessage, tg } from "../../telegram.ts";
import type { Channel } from "./types.ts";

interface Link { user_id: string; chat_id: number; locale: string }

/** The connected chats of this workspace's accounts. */
const chats = (db: DB, workspace: string) =>
  db.all<Link>("SELECT l.user_id, l.chat_id, l.locale FROM telegram_links l JOIN users u ON u.id = l.user_id WHERE u.workspace_id = ? AND u.disabled_at IS NULL", workspace);

export const telegram: Channel = {
  name: "telegram",
  configured: () => !!config.telegram,
  carries: (kind) => kind === "approval" || kind === "test",
  async send(db, n, now) {
    const a = n.kind === "approval" ? n.approval : undefined;
    if (n.kind === "approval" && !a) return { sent: 0, failed: 0 };
    const results = await Promise.all((await chats(db, n.workspace)).map(async (c) => {
      const r = await tg<{ message_id: number }>("sendMessage", { chat_id: c.chat_id, ...(a ? approvalMessage(c.locale, a, now) : { text: DICTS[c.locale === "de" ? "de" : "en"].notify.telegram.test }) });
      if (r.ok) {
        // Remembered so this message can be edited once the approval is settled.
        if (a) await db.run("INSERT INTO delivery_messages (notification_id, channel, target, message_id, created_at) VALUES (?, 'telegram', ?, ?, ?) ON CONFLICT DO NOTHING", n.id, String(c.chat_id), String(r.result.message_id), now);
        return true;
      }
      // 403: the person blocked the bot or deleted the chat. Nothing can reach them there any more, so the link goes.
      if (r.status === 403) await db.run("DELETE FROM telegram_links WHERE user_id = ? AND chat_id = ?", c.user_id, c.chat_id);
      else console.error(`[tend] Telegram did not take a message (${r.status ? `${r.status} ${r.description}`.trim() : r.description})`);
      return false;
    }));
    const sent = results.filter(Boolean).length;
    return { sent, failed: results.length - sent };
  },
  async resolved(db, n) {
    // Claimed by deleting: of any number of callers, one edits each message.
    const rows = await db.all<{ target: string; message_id: string }>("DELETE FROM delivery_messages WHERE notification_id = ? AND channel = 'telegram' RETURNING target, message_id", n.id);
    if (!rows.length || n.approval.status === "pending") return;
    const locales = new Map((await chats(db, n.workspace)).map((c) => [String(c.chat_id), c.locale]));
    await Promise.all(rows.map((r) => tg("editMessageText", { chat_id: Number(r.target), message_id: Number(r.message_id), ...resolvedMessage(locales.get(r.target) ?? "en", n.approval) })));
  },
};
