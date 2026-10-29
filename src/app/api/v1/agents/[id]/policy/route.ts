import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { policyView } from "@/server/permissions";
import { agentInWorkspace, setPolicy } from "@/server/repo";

/** The saved policy as the server would apply it, with every gateway tool's current decision. Operators only: a policy is not for visitors. */
export const GET = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { workspace } = await requireOperator(req, db);
  const { id } = await params;
  await agentInWorkspace(db, workspace, id);
  return json(await policyView(db, id));
});

/**
 * Sets what an agent may do: { rules: [...], enforcement?: "monitor" | "enforce", expectedVersion?: n }. Invalid policies are refused
 * whole, a policy that lets a spending tool run without approval is refused, and a stale expectedVersion is refused (409). Operators only.
 */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { id: by, workspace } = await requireOperator(req, db);
  const { id } = await params;
  await agentInWorkspace(db, workspace, id);
  const body = (await readJson(req)) as { rules?: unknown; enforcement?: unknown; expectedVersion?: unknown } | null;
  return json({ event: await setPolicy(db, id, body?.rules, body?.enforcement, by, body?.expectedVersion) });
});
