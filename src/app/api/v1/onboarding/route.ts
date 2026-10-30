import { getDb } from "@/server/db";
import { json, limit, readJson, requireOperator, route } from "@/server/http";
import { onboardingView, updateOnboarding } from "@/server/onboarding";

/** Where this account's setup guide stands. The checklist is worked out from the agent's real records on every call. */
export const GET = route(async (req) => {
  const db = await getDb();
  return json(await onboardingView(db, await requireOperator(req, db)));
});

/** Moves through the guide, skips it, restarts it, or completes it (only after TEND has seen the test action decided). */
export const POST = route(async (req) => {
  const db = await getDb();
  const s = await requireOperator(req, db);
  await limit(db, `onboarding:${s.id}`, 60);
  return json(await updateOnboarding(db, s, await readJson(req, 2_000)));
});
