import { after } from "next/server";
import { deliver, resendVerification } from "@/server/accounts";
import { getDb } from "@/server/db";
import { json, readJson, requireSameSite, route } from "@/server/http";

/** A new confirmation link, if the address has an unconfirmed account. The same answer for every address. */
export const POST = route(async (req) => {
  requireSameSite(req);
  const { result, outbox } = await resendVerification(await getDb(), req, await readJson(req, 1_000));
  after(() => deliver(outbox));
  return json(result, 202);
});
