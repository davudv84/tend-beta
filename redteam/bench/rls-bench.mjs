// Local benchmark: cost of row-level security with and without the signed context (needs a local PostgreSQL superuser URL in BENCH_DATABASE_URL).
import pg from "pg";
import { randomBytes } from "node:crypto";
const { postgres, migrate, enableIsolation } = await import("../../src/server/db.ts");
const { withRequestContext, bindWorkspace } = await import("../../src/server/db-context.ts");
const { registerAgent } = await import("../../src/server/repo.ts");
const BASE = process.env.BENCH_DATABASE_URL ?? "postgres://tend_test@127.0.0.1:54329/postgres";
const admin = new pg.Client({ connectionString: BASE }); await admin.connect();
for (const signed of [false, true]) {
  if (signed) process.env.TEND_CONTEXT_KEY = randomBytes(32).toString("hex"); else delete process.env.TEND_CONTEXT_KEY;
  const name = `tend_bench_${randomBytes(4).toString("hex")}`, role = `tend_bench_rt_${randomBytes(3).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(BASE); u.pathname = `/${name}`;
  const db = await postgres(u.toString()); await migrate(db);
  await db.run("INSERT INTO workspaces (id, name, created_at) VALUES ('wa','A',0),('wb','B',0)");
  const a = await registerAgent(db, { name: "a", model: "m", provider: "Custom" }, "u", "wa");
  const b = await registerAgent(db, { name: "b", model: "m", provider: "Custom" }, "u", "wb");
  for (const [id, n] of [[a.agent.id, 20000], [b.agent.id, 20000]]) await db.exec(`INSERT INTO events (id, agent_id, type, at, actor, data) SELECT 'e' || g || '${id}', '${id}', 'task.started', g, 'agent', '{}' FROM generate_series(1, ${n}) g`);
  await enableIsolation(db, role);
  const t = async (label, sql, ...p) => { const t0 = performance.now(); let r; for (let i = 0; i < 5; i++) r = await withRequestContext(async () => { bindWorkspace("wa"); return db.all(sql, ...p); }); return `${label} ${((performance.now() - t0) / 5).toFixed(1)}ms rows=${r.length}`; };
  console.log(signed ? "SIGNED  " : "UNSIGNED", await t("own 12000 recent", "SELECT * FROM events WHERE agent_id IN (?) ORDER BY seq DESC LIMIT 12000", a.agent.id), "|", await t("unfiltered scan", "SELECT seq FROM events"));
  await db.close(); await admin.query(`DROP DATABASE ${name} WITH (FORCE)`); await admin.query(`DROP ROLE IF EXISTS ${role}`);
}
await admin.end();
