import { getDb } from "@/server/db";
import { json, limit, requireOperator, route } from "@/server/http";
import { createLink, linkStatus, unlink } from "@/server/telegram";

/** Whether Telegram is set up on this server and connected for this account. */
export const GET = route(async (req) => {
  const db = await getDb();
  const s = await requireOperator(req, db);
  return json(await linkStatus(db, s.userId));
});

/**
 * A link to open in Telegram that connects the chat to this account: { url, expiresAt }. Signed-in accounts only. The token in it works
 * once, for 15 minutes; asking again ends the previous one.
 */
export const POST = route(async (req) => {
  const db = await getDb();
  const s = await requireOperator(req, db);
  await limit(db, `telegram-link:${s.id}`, 10);
  return json(await createLink(db, s.userId), 201);
});

/** Disconnects this account's Telegram chat. */
export const DELETE = route(async (req) => {
  const db = await getDb();
  const s = await requireOperator(req, db);
  return json({ disconnected: await unlink(db, s.userId) });
});
