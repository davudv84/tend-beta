import { getDb } from "@/server/db";
import { json, limit, readJson, requireOperator, route } from "@/server/http";
import { hasSubscription, removeSubscription, saveSubscription } from "@/server/notifications";

/**
 * Turns browser notifications on for this browser (a PushSubscription's endpoint and keys), or with { check: endpoint } asks whether this
 * browser already receives this account's notifications. The browser asks the person for permission first; the server never can.
 */
export const POST = route(async (req) => {
  const db = await getDb();
  const s = await requireOperator(req, db);
  await limit(db, `push-sub:${s.id}`, 20);
  const body = await readJson(req, 4_000);
  if (body && typeof body === "object" && "check" in body) return json({ subscribed: await hasSubscription(db, s.userId, (body as { check: unknown }).check) });
  await saveSubscription(db, s.userId, body);
  return json({ subscribed: true }, 201);
});

/** Turns them off for one browser. Only the account that subscribed it can. */
export const DELETE = route(async (req) => {
  const db = await getDb();
  const s = await requireOperator(req, db);
  return json({ removed: await removeSubscription(db, s.userId, await readJson(req, 4_000)) });
});
