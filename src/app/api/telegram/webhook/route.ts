import { getDb } from "@/server/db";
import { json, route } from "@/server/http";
import { receiveWebhook } from "@/server/telegram";

/**
 * Where Telegram delivers what happens in the bot's chats (registered with scripts/telegram-webhook.mjs). Every request must repeat this
 * server's secret in X-Telegram-Bot-Api-Secret-Token: receiveWebhook refuses anything else with 403 before reading it, as it does every
 * request while Telegram is not set up. A request that passed is always answered 200, so Telegram does not send it again.
 */
export const POST = route(async (req) => {
  await receiveWebhook(req, getDb);
  return json({ ok: true });
});
