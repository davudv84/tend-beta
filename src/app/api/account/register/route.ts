import { after } from "next/server";
import { deliver, register } from "@/server/accounts";
import { getDb } from "@/server/db";
import { json, readJson, requireSameSite, route } from "@/server/http";

/** Sign up with an e-mail address and a password. The same answer for every address; mails go out after the response. */
export const POST = route(async (req) => {
  requireSameSite(req);
  const { result, outbox } = await register(await getDb(), req, await readJson(req, 2_000));
  after(() => deliver(outbox));
  return json(result, 202);
});
