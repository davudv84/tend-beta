import { after } from "next/server";
import { deliver, verifyEmail } from "@/server/accounts";
import { getDb } from "@/server/db";
import { json, readJson, requireSameSite, route } from "@/server/http";

/** Confirms an e-mail address with the token from the link (sent by the page, never in the address bar's query). */
export const POST = route(async (req) => {
  requireSameSite(req);
  const { result, outbox } = await verifyEmail(await getDb(), req, await readJson(req, 1_000));
  after(() => deliver(outbox));
  return json(result);
});
