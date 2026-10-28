// Isolated checks: Tend's own gateway code, run on a PRIVATE COPY, with the agent's real rules.
//
// What is private: a brand-new in-memory database, a new temp notes folder with invented notes, a made-up payments key and
// a throwaway probe agent. The real database, the real notes folder and the real keys are never passed in, never opened and
// never named here: the only input is the list of rules (plain data). The gateway's folder and key are replaced for this
// code only (withGatewayConfig), so real requests in the same process keep using the real ones.
//
// What a pass means: "on a private copy, with these rules, Tend's gateway did what the claim says." It does not say anything
// about the live database, the agent's own computer, or any way around the gateway. Every expectation is worked out from the
// rules themselves (expectedEffect), not from Tend's own decision function, so a faulty decision function cannot grade itself.
//
// Fail closed: a probe that errors, a tool that is not set up, a timeout or a setup failure is "not verified", never "verified".
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CheckId, CheckResult, CheckStatus, Fact } from "../lib/verification.ts";
import { claimToken } from "./authz.ts";
import { memoryDb, type DB } from "./db.ts";
import { executeTool, fakePayments, requestExecution, toolCatalog, withGatewayConfig } from "./gateway.ts";
import { HttpError } from "./http.ts";
import { NEVER_AUTOMATIC, type Rule } from "./policy.ts";
import { decide, getAgent, registerAgent } from "./repo.ts";

/** The four calls the checks make. The real ones by default; tests pass deliberately broken ones to prove the checks notice. */
export interface GatewayApi {
  requestExecution: typeof requestExecution;
  claimToken: typeof claimToken;
  executeTool: typeof executeTool;
  decide: typeof decide;
}
export const realApi: GatewayApi = { requestExecution, claimToken, executeTool, decide };

const FORGED = `tend_az_${"A".repeat(43)}`;
const SEED_FILES = { "verify-seed.txt": "INVENTED seed file.", "verify-other.txt": "INVENTED other file." };
const SEED_NOTES = { standup: "INVENTED standup note.", printer: "INVENTED printer note.", garden: "INVENTED garden note." };

/** What a probe sends, and a changed version of it (to prove a change is refused). */
const PROBES: Record<string, { params: object; changed?: object }> = {
  list_notes: { params: {} },
  read_note: { params: { name: "standup" }, changed: { name: "garden" } },
  write_note: { params: { name: "verify-probe", text: "invented probe text" }, changed: { name: "verify-probe", text: "changed probe text" } },
  read_test_file: { params: { path: "verify-seed.txt" }, changed: { path: "verify-other.txt" } },
  write_test_file: { params: { path: "verify-probe.txt", text: "invented probe text" }, changed: { path: "verify-probe.txt", text: "changed probe text" } },
  delete_test_file: { params: { path: "verify-seed.txt" }, changed: { path: "verify-other.txt" } },
  pay_invoice: { params: { invoice: "INV-1", amountCents: 500, currency: "EUR", payee: "PAYEE-1" }, changed: { invoice: "INV-1", amountCents: 501, currency: "EUR", payee: "PAYEE-1" } },
  test_ping: { params: { message: "verification" }, changed: { message: "changed" } },
};

export type Expected = "allow" | "approve" | "deny";
/**
 * What the rules say about one tool and action, read straight from the rules. A tool no rule mentions is denied. Exactly one
 * plain rule decides it (spending is never "allow"). Anything more involved (prefixes, permissions, several rules) is
 * null: not tested here, and reported as such.
 */
export function expectedEffect(rules: Rule[], tool: string, action: string): Expected | null {
  const hits = rules.filter((r) => r.tool === tool && (r.action === "*" || r.action === action));
  if (hits.length === 0) return "deny";
  if (hits.length > 1 || hits[0].resourcePrefix !== undefined || hits[0].permission !== undefined) return null;
  return hits[0].effect === "allow" && NEVER_AUTOMATIC.has(tool) ? "approve" : hits[0].effect;
}

/** Tend's deliberate refusals. Any other failure (a tool not set up, a crash) is a broken probe, not a refusal. */
const REFUSALS = new Set(["invalid_token", "not_approved", "not_permitted", "mismatch", "already_consumed", "token_expired", "authorization_not_found", "unknown_tool", "invalid_params", "invalid_request"]);
class ProbeError extends Error {}

/** True if Tend refused. False if the call went through. A probe that failed for another reason is not an answer at all. */
async function refused(fn: () => Promise<unknown>) {
  try {
    await fn();
    return false;
  } catch (e) {
    if (e instanceof HttpError && REFUSALS.has(e.code)) return true;
    throw new ProbeError(e instanceof HttpError ? `unexpected ${e.code}` : "probe failed");
  }
}

interface Target { tool: string; action: string; params: object; changed?: object; expected: Expected | null }
interface Ctx {
  db: DB; api: GatewayApi; dir: string; probe: Awaited<ReturnType<typeof getAgent>> & object; other: Awaited<ReturnType<typeof getAgent>> & object;
  targets: Target[]; custom: string[];
}

const hashFolder = (dir: string) => createHash("sha256").update(readdirSync(dir).sort().map((f) => `${f}:${readFileSync(path.join(dir, f), "utf8")}`).join("\n")).digest("hex");
const count = async (db: DB, sql: string, ...p: unknown[]) => (await db.get<{ n: number }>(sql, ...p))!.n;
const state = async (c: Ctx) => ({
  files: hashFolder(c.dir),
  pending: await count(c.db, "SELECT COUNT(*)::int AS n FROM reviews WHERE status = 'pending'"),
  authorizations: await count(c.db, "SELECT COUNT(*)::int AS n FROM authorizations"),
});
const ran = (c: Ctx, id: string) => count(c.db, "SELECT COUNT(*)::int AS n FROM events WHERE type = 'tool.called' AND (data::jsonb)->>'authorizationId' = ? AND (data::jsonb)->>'outcome' = 'success'", id).then((n) => n > 0 || fakePayments().has(id));

async function ask(c: Ctx, t: Target) {
  try {
    return (await c.api.requestExecution(c.db, c.probe, { tool: t.tool, params: t.params }, null)).view;
  } catch {
    throw new ProbeError("request failed");
  }
}

const verdict = (id: CheckId, failed: Set<string>, tested: string[], skippedCustom: string[]): CheckResult => {
  const facts: Record<string, Fact> = { tested, ...(skippedCustom.length && { notTested: skippedCustom }) };
  return failed.size > 0
    ? { id, group: "isolated", status: "at_risk", why: "failed", facts: { ...facts, failed: [...failed] } }
    : { id, group: "isolated", status: "verified", facts };
};
const notVerified = (id: CheckId, why: string, facts: Record<string, Fact> = {}): CheckResult => ({ id, group: "isolated", status: "not_verified", why, facts });
const names = (ts: Target[]) => ts.map((t) => t.tool);

// ---- the five checks ----------------------------------------------------------------------------------------------

/** What your rules forbid, Tend refuses: the request is denied, nothing is queued, and a forged or missing pass runs nothing. */
async function forbiddenRefused(c: Ctx, failed: Set<string>): Promise<CheckResult> {
  const targets = c.targets.filter((t) => t.expected === "deny");
  if (targets.length === 0) return notVerified("forbidden_refused", "nothing_forbidden", c.custom.length ? { notTested: c.custom } : {});
  for (const t of targets) {
    const before = await state(c);
    const view = await ask(c, t);
    if (view.status !== "denied") failed.add("request_denied");
    if (!(await refused(() => c.api.executeTool(c.db, c.probe, { authorizationId: view.id, token: FORGED, tool: t.tool, params: t.params })))) failed.add("forged_pass_refused");
    if (!(await refused(() => c.api.executeTool(c.db, c.probe, { authorizationId: view.id, tool: t.tool, params: t.params })))) failed.add("missing_pass_refused");
    const after = await state(c);
    if (after.pending !== before.pending) failed.add("nothing_queued");
    if (after.files !== before.files || (await ran(c, view.id))) failed.add("nothing_ran");
  }
  return verdict("forbidden_refused", failed, names(targets), c.custom);
}

/** Made-up actions, paths and web addresses in names, and extra instructions, are refused, and create nothing. */
async function malformedRefused(c: Ctx, failed: Set<string>): Promise<CheckResult> {
  const tools = new Set(toolCatalog().map((t) => t.tool));
  const cases: [string, () => Promise<unknown>][] = [
    ["unknown_action", () => c.api.requestExecution(c.db, c.probe, { tool: "delete_everything", params: {} }, null)],
    ["inherited_name", () => c.api.requestExecution(c.db, c.probe, { tool: "__proto__", params: {} }, null)],
    ["inherited_name", () => c.api.requestExecution(c.db, c.probe, { tool: "constructor", params: {} }, null)],
    ["extra_instruction", () => c.api.requestExecution(c.db, c.probe, { tool: "list_notes", params: {}, command: "rm -rf /" } as never, null)],
  ];
  for (const tool of ["write_note", "read_note"].filter((t) => tools.has(t)))
    for (const name of ["../tend-verify-escape", "/etc/passwd", "a/b", "https://evil.example/x", "..", "NAME WITH SPACE"])
      cases.push(["hidden_path_or_address", () => c.api.requestExecution(c.db, c.probe, { tool, params: tool === "write_note" ? { name, text: "x" } : { name } }, null)]);
  if (tools.has("write_note")) cases.push(["extra_field", () => c.api.requestExecution(c.db, c.probe, { tool: "write_note", params: { name: "ok", text: "x", path: "/tmp" } }, null)]);

  const before = await state(c);
  for (const [name, fn] of cases) if (!(await refused(fn))) failed.add(name);
  const after = await state(c);
  if (after.authorizations !== before.authorizations) failed.add("nothing_created");
  if (after.files !== before.files || existsSync(path.join(path.dirname(c.dir), "tend-verify-escape.txt"))) failed.add("nothing_written");
  return verdict("malformed_refused", failed, [], []);
}

/** Actions set to "Ask me first" wait for a person: a request is held, no pass is given, and a forged or missing pass runs nothing. */
async function askFirstHolds(c: Ctx, failed: Set<string>): Promise<CheckResult> {
  const targets = c.targets.filter((t) => t.expected === "approve");
  if (targets.length === 0) return notVerified("ask_first_holds", "nothing_asks", c.custom.length ? { notTested: c.custom } : {});
  for (const t of targets) {
    const before = await state(c);
    const view = await ask(c, t);
    if (view.status !== "pending") failed.add("held_for_you");
    if ((await count(c.db, "SELECT COUNT(*)::int AS n FROM reviews WHERE id = ? AND status = 'pending'", view.id)) !== 1) failed.add("waiting_in_queue");
    const claim = (await c.api.claimToken(c.db, c.probe, view.id)).view as { status: string; token?: string };
    if (claim.status !== "pending" || claim.token !== undefined) failed.add("no_pass_before_decision");
    if (!(await refused(() => c.api.executeTool(c.db, c.probe, { authorizationId: view.id, token: FORGED, tool: t.tool, params: t.params })))) failed.add("forged_pass_refused");
    if (!(await refused(() => c.api.executeTool(c.db, c.probe, { authorizationId: view.id, tool: t.tool, params: t.params })))) failed.add("missing_pass_refused");
    if ((await state(c)).files !== before.files || (await ran(c, view.id))) failed.add("nothing_ran");
  }
  return verdict("ask_first_holds", failed, names(targets), c.custom);
}

/** A rejection is final: no pass can be taken afterwards, and a forged one runs nothing. */
async function rejectionHolds(c: Ctx, failed: Set<string>): Promise<CheckResult> {
  const targets = c.targets.filter((t) => t.expected === "approve");
  if (targets.length === 0) return notVerified("rejection_holds", "nothing_asks", c.custom.length ? { notTested: c.custom } : {});
  for (const t of targets) {
    const before = await state(c);
    const view = await ask(c, t);
    if (view.status !== "pending") {
      failed.add("held_for_you");
      throw new ProbeError("request was not held");
    }
    await c.api.decide(c.db, view.id, "rejected");
    if (!(await refused(() => c.api.claimToken(c.db, c.probe, view.id)))) failed.add("no_pass_after_rejection");
    if (!(await refused(() => c.api.executeTool(c.db, c.probe, { authorizationId: view.id, token: FORGED, tool: t.tool, params: t.params })))) failed.add("forged_pass_refused");
    if ((await count(c.db, "SELECT COUNT(*)::int AS n FROM authorizations WHERE id = ? AND status = 'rejected'", view.id)) !== 1) failed.add("stays_rejected");
    if ((await state(c)).files !== before.files || (await ran(c, view.id))) failed.add("nothing_ran");
  }
  return verdict("rejection_holds", failed, names(targets), c.custom);
}

/** An approval works once, only for what was approved, only for the agent it was given to, and not after it expires. */
async function approvalOnce(c: Ctx, failed: Set<string>): Promise<CheckResult> {
  const targets = c.targets.filter((t) => t.expected === "approve" || t.expected === "allow");
  if (targets.length === 0) return notVerified("approval_once", "nothing_allowed", c.custom.length ? { notTested: c.custom } : {});
  /** A request taken to the point where the agent holds a pass. */
  const approved = async (t: Target, now: number) => {
    const view = await ask(c, t);
    if (view.status === "pending") await c.api.decide(c.db, view.id, "approved");
    else if (view.status !== "approved") throw new ProbeError("request was neither held nor allowed");
    else if (t.expected === "approve") failed.add("held_for_you"); // allowed on its own although the rules say to ask
    const pass = (await c.api.claimToken(c.db, c.probe, view.id, now)).view as { token?: string };
    if (typeof pass.token !== "string") throw new ProbeError("no pass after approval");
    return { id: view.id, token: pass.token };
  };
  for (const t of targets) {
    const { id, token } = await approved(t, Date.now());
    const body = { authorizationId: id, token, tool: t.tool, params: t.params };
    // The attack that matters most: an approved request, and a guessed pass.
    if (!(await refused(() => c.api.executeTool(c.db, c.probe, { ...body, token: FORGED })))) failed.add("wrong_pass_refused");
    if (t.changed && !(await refused(() => c.api.executeTool(c.db, c.probe, { ...body, params: t.changed as object })))) failed.add("changed_request_refused");
    if (!(await refused(() => c.api.claimToken(c.db, c.other, id)))) failed.add("other_agent_refused_pass");
    if (!(await refused(() => c.api.executeTool(c.db, c.other, body)))) failed.add("other_agent_refused_run");
    const out = await c.api.executeTool(c.db, c.probe, body);
    if (out.executed !== true) throw new ProbeError("approved action did not run");
    const times = await count(c.db, "SELECT COUNT(*)::int AS n FROM events WHERE type = 'tool.called' AND (data::jsonb)->>'authorizationId' = ? AND (data::jsonb)->>'outcome' = 'success'", id);
    if (times !== 1) failed.add("ran_once");
    if (!(await refused(() => c.api.executeTool(c.db, c.probe, body)))) failed.add("second_use_refused");
    if (!(await refused(() => c.api.claimToken(c.db, c.probe, id)))) failed.add("no_second_pass");
    // A pass that was not used in time is dead: take one, wait past its life, and try.
    const t0 = Date.now();
    const late = await approved(t, t0);
    if (!(await refused(() => c.api.executeTool(c.db, c.probe, { authorizationId: late.id, token: late.token, tool: t.tool, params: t.params }, t0 + 61_000)))) failed.add("expired_pass_refused");
    if (await ran(c, late.id)) failed.add("expired_ran");
  }
  return verdict("approval_once", failed, names(targets), c.custom);
}

// ---- running them -------------------------------------------------------------------------------------------------

const ORDER: [CheckId, (c: Ctx, failed: Set<string>) => Promise<CheckResult>][] = [
  ["forbidden_refused", forbiddenRefused], ["malformed_refused", malformedRefused], ["ask_first_holds", askFirstHolds], ["rejection_holds", rejectionHolds], ["approval_once", approvalOnce],
];
const all = (status: CheckStatus, why: string): CheckResult[] => ORDER.map(([id]) => ({ id, group: "isolated", status, why, facts: {} }) as CheckResult);
/** All five isolated checks as not verified, for when they cannot be run at all. */
export const isolatedNotVerified = (why: string) => all("not_verified", why);

/** Runs the five isolated checks against a private copy that carries `rules`. Never throws; never touches anything real. */
export async function runIsolatedChecks(input: { rules: Rule[] }, api: GatewayApi = realApi, opts: { timeoutMs?: number } = {}): Promise<CheckResult[]> {
  const dir = mkdtempSync(path.join(tmpdir(), "tend-verify-"));
  for (const [name, text] of Object.entries(SEED_NOTES)) writeFileSync(path.join(dir, `${name}.txt`), `${text}\n`);
  for (const [name, text] of Object.entries(SEED_FILES)) writeFileSync(path.join(dir, name), `${text}\n`);
  let db: DB | undefined;
  const work = withGatewayConfig({ notesDir: dir, sandboxDir: dir, paymentsKey: `verify_${randomBytes(18).toString("hex")}` }, async () => {
    try {
      try {
        db = await memoryDb();
      } catch {
        return all("not_verified", "could_not_start");
      }
      const probeReg = await registerAgent(db, { name: "Verification probe", model: "none", provider: "Custom" });
      const otherReg = await registerAgent(db, { name: "Verification other", model: "none", provider: "Custom" });
      try {
        // As stored, byte for byte: what a request is judged against in real life, including rules saved before today's save-time checks.
        await db.run("UPDATE agents SET policy = ?, enforcement = 'enforce' WHERE id = ?", JSON.stringify(input.rules), probeReg.agent.id);
      } catch {
        return all("not_verified", "rules_not_testable");
      }
      const targets: Target[] = toolCatalog()
        .filter((t) => PROBES[t.tool])
        .map((t) => ({ tool: t.tool, action: t.action, params: PROBES[t.tool].params, changed: PROBES[t.tool].changed, expected: expectedEffect(input.rules, t.tool, t.action) }));
      const ctx: Ctx = {
        db, api, dir, probe: (await getAgent(db, probeReg.agent.id))!, other: (await getAgent(db, otherReg.agent.id))!,
        targets: targets.filter((t) => t.expected !== null), custom: targets.filter((t) => t.expected === null).map((t) => t.tool),
      };
      const out: CheckResult[] = [];
      for (const [id, check] of ORDER) {
        const failed = new Set<string>();
        try {
          out.push(await check(ctx, failed));
        } catch {
          // The probe could not finish. If it had already seen something wrong, that is the finding (a broken protection
          // often leaves the rest of the probe unable to continue); if not, it simply could not be run.
          out.push(failed.size > 0 ? { id, group: "isolated", status: "at_risk", why: "failed", facts: { failed: [...failed] } } : notVerified(id, "could_not_run"));
        }
      }
      return out;
    } catch {
      return all("not_verified", "could_not_run");
    } finally {
      await db?.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });
  work.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<CheckResult[]>((resolve) => (timer = setTimeout(() => resolve(all("not_verified", "timed_out")), opts.timeoutMs ?? 30_000)));
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
