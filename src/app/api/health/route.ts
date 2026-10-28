import { getDb } from "@/server/db";
import { json, route } from "@/server/http";

/** Liveness, schema version and which kind of storage is in use (never connection details). */
export const GET = route(async () => {
  const db = await getDb();
  const v = await db.get<{ v: number }>("SELECT MAX(version) AS v FROM schema_migrations");
  return json({ ok: true, schema: v?.v ?? 0, storage: db.kind === "postgres" ? "postgres" : "embedded" });
});
