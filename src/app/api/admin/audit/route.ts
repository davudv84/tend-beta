import { verifyAudit, type Checkpoint } from "@/server/audit-chain";
import { getDb } from "@/server/db";
import { json, requireAdmin, route } from "@/server/http";

/**
 * Checks the whole event log's hash chain. The admin only: the chain spans every workspace. Optional query params
 * (firstSeq, firstHash, head, headSeq) pass a checkpoint kept outside TEND from an earlier run; the chain is then
 * also checked to still start at, and lead up to, exactly what you kept — so a cut prefix or an altered oldest event is caught.
 */
export const GET = route(async (req) => {
  const db = await getDb();
  await requireAdmin(req, db);
  const p = new URL(req.url).searchParams;
  const num = (k: string) => (p.get(k) !== null && /^[0-9]{1,18}$/.test(p.get(k)!) ? Number(p.get(k)) : undefined);
  const hex = (k: string) => (/^[0-9a-f]{64}$/.test(p.get(k) ?? "") ? p.get(k)! : undefined);
  const expected: Checkpoint = { firstSeq: num("firstSeq"), firstHash: hex("firstHash"), head: hex("head"), headSeq: num("headSeq") };
  const any = Object.values(expected).some((v) => v !== undefined);
  return json(await verifyAudit(db, 2_000, any ? expected : undefined));
});
