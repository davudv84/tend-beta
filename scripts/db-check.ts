// Checks the database in DATABASE_URL before you deploy: connects, applies migrations, proves it can write
// (in a transaction that is rolled back) and reports what is stored. Never prints credentials.
//   npm run db:check              (reads DATABASE_URL from the environment or .env.local)
import { migrate, postgres } from "../src/server/db.ts";

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local (e.g. with `vercel env pull .env.local`) or export it.");
  process.exit(1);
}

const db = await postgres(url);
const rollback = new Error("rollback");
try {
  await migrate(db);
  await db.tx(async (q) => {
    await q.run("INSERT INTO meta (key, value) VALUES ('db-check', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", String(Date.now()));
    throw rollback;
  }).catch((e) => { if (e !== rollback) throw e; });
  const schema = (await db.get<{ v: number }>("SELECT MAX(version) AS v FROM schema_migrations"))!.v;
  const n = (await db.get<{ simulated: number; connected: number; events: number }>(
    "SELECT (SELECT COUNT(*) FROM agents WHERE origin = 'demo') AS simulated, (SELECT COUNT(*) FROM agents WHERE origin = 'connected') AS connected, (SELECT COUNT(*) FROM events) AS events",
  ))!;
  console.log(`✓ Connected to ${new URL(url).host}`);
  console.log(`✓ Schema version ${schema}; writes work`);
  console.log(`  ${n.simulated} simulated agents · ${n.connected} connected agents · ${n.events} events`);
} catch (e) {
  console.error("✗ Database check failed:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}
