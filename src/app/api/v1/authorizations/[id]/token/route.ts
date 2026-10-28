import { authAgent } from "@/server/agent-auth";
import { claimToken } from "@/server/authz";
import { getDb } from "@/server/db";
import { json, route } from "@/server/http";

/** 202 while a human is still deciding, 200 with a single-use token once approved, 403 for anything else. Safe to retry: a new token replaces the old one. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const agent = await authAgent(db, req);
  const { view } = await claimToken(db, agent, (await params).id);
  return json(view, view.status === "pending" ? 202 : 200);
});
