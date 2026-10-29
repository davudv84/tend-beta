// Verified Protection: runs the protection checks for one connected agent, stores the evidence, and reads it back.
// See docs/verification.md for what each check proves and, as important, what it does not.
//
// Never touches customer data:
//  - the live checks get the database through readOnly(), which refuses anything but SELECT, and look at the notes folder with lstat only;
//  - the isolated checks get nothing real at all: only the agent's rules, as plain data (verification-sandbox.ts);
//  - the only writes are this run's own result row and its audit event.
import { randomUUID } from "node:crypto";
import { countByStatus, type CheckResult, type VerificationRun } from "../lib/verification.ts";
import type { DB, Q } from "./db.ts";
import { toolCatalog } from "./gateway.ts";
import { HttpError } from "./http.ts";
import { parsePolicy } from "./policy.ts";
import { agentRow, insertEvent } from "./repo.ts";
import { agentIsolated, alertIfOutside, everOutside, folderClosed, historyApproved, historyOnce } from "./verification-live.ts";
import { expectedEffect, isolatedNotVerified, runIsolatedChecks, type GatewayApi } from "./verification-sandbox.ts";

const SELECT_ONLY = /^\s*(select|with)\b/i;
/** Anything that writes, changes settings or calls a function with side effects, even inside a SELECT or a WITH. */
const FORBIDDEN = /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|call|set_config|pg_advisory\w*|nextval|setval|lo_\w+)\b/i;
const refuse = () => Promise.reject(new Error("verification is read-only"));
/**
 * The database as the live checks see it: queries that read, and nothing else. Two layers: this wrapper refuses anything
 * that isn't a plain read, and runVerification runs the checks inside a transaction the database itself holds read-only.
 */
export const readOnly = (db: Q): Q => {
  const ok = (sql: string) => SELECT_ONLY.test(sql) && !FORBIDDEN.test(sql);
  return {
    all: (sql, ...p) => (ok(sql) ? db.all(sql, ...p) : refuse()),
    get: (sql, ...p) => (ok(sql) ? db.get(sql, ...p) : refuse()),
    run: refuse,
    exec: refuse,
    lockEvents: refuse,
  };
};

const running = new Set<string>();

interface Options { api?: GatewayApi; notesDir?: string; sandboxTimeoutMs?: number }

export async function runVerification(db: DB, agentId: string, by?: string, opts: Options = {}): Promise<VerificationRun> {
  const row = await agentRow(db, agentId);
  if (!row) throw new HttpError(404, "agent_not_found", `No agent with id “${agentId}”.`);
  if (row.origin !== "connected") throw new HttpError(409, "verification_unavailable", "Demo agents don’t use Tend’s gateway, so there is nothing to check.");
  if (running.has(agentId)) throw new HttpError(409, "verification_running", "The checks for this agent are already running.");
  running.add(agentId);
  try {
    const started = Date.now();
    const parsed = parsePolicy(row.policy);
    const notesDir = "notesDir" in opts ? opts.notesDir : process.env.TEND_GATEWAY_NOTES_DIR;
    // The notes folder is looked at (permissions only) outside the database; the records are read in a read-only transaction.
    const folder = await folderClosed(notesDir);
    const records = await db.tx(async (q) => {
      await q.run("SET TRANSACTION READ ONLY"); // enforced by the database: any write in here fails
      const ro = readOnly(q);
      return [await historyApproved(ro, agentId), await historyOnce(ro, agentId), await everOutside(ro, agentId)];
    });
    const live: CheckResult[] = [folder, alertIfOutside(row.enforcement), ...records];
    // Rules that cannot be read mean nothing can be tested: fail closed.
    // With a central policy assigned the private copy (which carries the agent's own rules only) would grade the wrong rules and could
    // report a tool as refused that the central policy allows. Until the copy carries both, say "not verified" rather than guess.
    const isolated = row.central_policy_id ? isolatedNotVerified("central_policy_assigned") : parsed.ok ? await runIsolatedChecks({ rules: parsed.rules }, opts.api, { timeoutMs: opts.sandboxTimeoutMs }) : isolatedNotVerified("rules_unreadable");
    const checks = [...live, ...isolated, agentIsolated()];
    const rules = parsed.ok ? parsed.rules : [];
    const run: VerificationRun = {
      id: `vr_${randomUUID().replaceAll("-", "").slice(0, 16)}`, agentId, at: Date.now(), ...(by && { by }),
      configVersion: row.config_version, enforcement: row.enforcement, durationMs: Date.now() - started, checks,
      runsWithoutAsking: toolCatalog().filter((t) => expectedEffect(rules, t.tool, t.action) === "allow").map((t) => t.tool),
    };
    const counts = countByStatus(checks);
    await db.tx(async (q) => {
      await q.lockEvents();
      await q.run(
        "INSERT INTO verification_runs (id, agent_id, created_at, created_by, config_version, enforcement, duration_ms, results) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        run.id, agentId, run.at, by ?? null, run.configVersion, run.enforcement, run.durationMs, JSON.stringify({ checks, runsWithoutAsking: run.runsWithoutAsking }));
      await insertEvent(q, { agentId, type: "verification.run", actor: "system", at: run.at, data: { runId: run.id, ...counts, ...(by && { by }) } });
    });
    return run;
  } finally {
    running.delete(agentId);
  }
}

/** The most recent run for an agent, or null. Operators only (the route checks). */
export async function latestVerification(q: Q, agentId: string): Promise<VerificationRun | null> {
  const r = await q.get<{ id: string; created_at: number; created_by: string | null; config_version: number; enforcement: "monitor" | "enforce"; duration_ms: number; results: string }>(
    "SELECT * FROM verification_runs WHERE agent_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", agentId);
  if (!r) return null;
  const { checks, runsWithoutAsking } = JSON.parse(r.results) as Pick<VerificationRun, "checks" | "runsWithoutAsking">;
  return { id: r.id, agentId, at: r.created_at, ...(r.created_by && { by: r.created_by }), configVersion: r.config_version, enforcement: r.enforcement, durationMs: r.duration_ms, checks, runsWithoutAsking };
}
