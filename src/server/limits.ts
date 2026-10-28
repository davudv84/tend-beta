// The shared counter behind every rate limit and quota. Kept apart from http.ts so the session code can use it without a cycle.
import type { Q } from "./db.ts";

interface Window { windowMs?: number; cost?: number; now?: number }

/** Adds `cost` to this window's counter and says whether the caller is still within `max`. Nothing is stored for a refused caller beyond the count. */
export async function spend(q: Q, key: string, max: number, { windowMs = 60_000, cost = 1, now = Date.now() }: Window = {}) {
  const minute = Math.floor(now / 60_000);
  // A window is identified by the last minute it covers, so one cleanup rule ("ended more than a minute ago") fits windows of any length.
  const bucket = (Math.floor(now / windowMs) + 1) * (windowMs / 60_000) - 1;
  const r = await q.get<{ n: number }>(
    "INSERT INTO rate_limits (key, bucket, n) VALUES (?, ?, ?) ON CONFLICT (key, bucket) DO UPDATE SET n = rate_limits.n + ? RETURNING n",
    key, bucket, cost, cost,
  );
  if (Math.random() < 0.02) await q.run("DELETE FROM rate_limits WHERE bucket < ?", minute - 1);
  return { ok: (r?.n ?? 0) <= max, n: r?.n ?? 0, retryAfter: Math.max(1, Math.ceil(((bucket + 1) * 60_000 - now) / 1000)) };
}
