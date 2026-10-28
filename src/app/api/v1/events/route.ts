import { authAgent } from "@/server/agent-auth";
import { viewerOf } from "@/server/session";
import { getDb } from "@/server/db";
import { clientIp, HttpError, json, limit, readJson, route } from "@/server/http";
import { ingestEvents } from "@/server/repo";
import { since } from "@/server/sync";

/** Incremental events after a sequence number, for keeping the UI in sync. */
export const GET = route(async (req) => {
  const db = await getDb();
  const viewer = await viewerOf(db, req);
  const seq = Number(new URL(req.url).searchParams.get("since") ?? 0);
  if (!Number.isInteger(seq) || seq < 0) throw new HttpError(400, "invalid_since", "since must be a non-negative integer.");
  if (viewer.role === "visitor") await limit(db, `poll:${clientIp(req)}`, 240);
  return json(await since(db, viewer, seq));
});

/** Agent event ingestion: one event, or { events: [...] } with up to 50. Authenticated by API key. */
export const POST = route(async (req) => {
  const db = await getDb();
  const agent = await authAgent(db, req);
  const body = (await readJson(req)) as Record<string, unknown> | null;
  const events = body && Array.isArray(body.events) ? body.events : [body];
  return json({ agentId: agent.id, results: await ingestEvents(db, agent, events) }, 202);
});
