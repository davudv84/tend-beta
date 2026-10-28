import { PROTOCOL, QUESTIONS } from "@/lib/contract";
import { authAgent } from "@/server/agent-auth";
import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { ingestCheckIn } from "@/server/repo";

export const GET = route(async () =>
  json({ protocol: PROTOCOL, questions: QUESTIONS.map(({ id, text }) => ({ id, text })), docs: "/developers" }),
);

/** Structured check-ins from connected agents. The API key identifies the agent. */
export const POST = route(async (req) => {
  const db = await getDb();
  const agent = await authAgent(db, req);
  return json({ accepted: true, ...(await ingestCheckIn(db, agent, await readJson(req), "agent")) }, 201);
});
