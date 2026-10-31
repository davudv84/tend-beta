import { config } from "@/server/config";
import { getDb, tlsMode } from "@/server/db";
import { json, route } from "@/server/http";

/** Liveness, schema version, which kind of storage is in use and how its certificate is checked (never connection details). */
export const GET = route(async () => {
  const db = await getDb();
  const v = await db.get<{ v: number }>("SELECT MAX(version) AS v FROM schema_migrations");
  const postgres = db.kind === "postgres";
  return json({ ok: true, schema: v?.v ?? 0, storage: postgres ? "postgres" : "embedded", ...(postgres && { tls: tlsMode(config.databaseUrl) }) });
});
