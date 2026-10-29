// The trusted execution wrapper. A sensitive tool function runs only inside gate.run(), and only after Tend
// has authorized exactly this action. Default flow, one round trip when the policy allows it: authorize-and-spend → act;
// when a person must decide: ask → wait → spend → act. flow: "token" keeps the older authorize → claim token → consume → act.
//
//   const out = await gate.run({ tool: "send_payment", action: "execute", resource: "INV-1", detail: "EUR 5.00 to X" }, () => pay());
//   out.executed === true only if Tend said yes. Every other outcome means nothing was done; `out.detail`, when present, says why in words.
//
// Fail closed: a timeout, a network error, a 4xx/5xx, a malformed answer or an unexpected body all end in
// "do not act". Creating a request is retried (it is idempotent); consuming never is. Nothing here prints a
// token or a key, and errors carry only status and code. What reaches Tend about the call is identifiers only.
//
// What this does NOT do: stop code that skips the gate, or that holds the real credentials itself.
// This is cooperative enforcement. See docs/enforcement.md.
import { randomUUID } from "node:crypto";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const transient = (e) => !e.status || e.status >= 500;
const same = (a, b) => (a ?? null) === (b ?? null);
/** Why a call to TEND failed, in words: a hint from the client, else TEND's own validation errors or message. */
const why = (e) => e.hint ?? (e.body?.errors?.join?.("; ") || e.body?.message || undefined);

export function createGate({ tend, approvalTimeoutMs = 120_000, pollMs = 2_000, retries = 2, retryMs = 500, onPending, log = () => {}, flow = "fast" }) {
  /**
   * @param request { tool, action, resource?, detail? }  what is being authorized and, byte for byte, what will be done
   * @param execute  async ({ authorizationId }) => result. The protected action: called at most once, and only after a successful consume.
   * @param report   optional (event) => Promise: tells Tend's monitoring what happened. Failures to report never change the outcome.
   */
  async function run(request, execute, report = async () => {}) {
    const req = { tool: request.tool, action: request.action, ...(request.resource && { resource: request.resource }), ...(request.detail && { detail: request.detail }), ...(request.args && { args: request.args }) };
    let authorizationId;
    const label = `${req.tool}.${req.action}${req.resource ? ` ${req.resource}` : ""}`;

    const stop = async (outcome, reason, event = {}) => {
      log(`  gate ${label} → not executed (${outcome}${reason ? `: ${reason}` : ""})`);
      try {
        await report({ ...req, outcome: event.outcome ?? "cancelled", ...(authorizationId && { authorizationId }), ...(event.policy && { policy: event.policy }), error: reason ? `${outcome}: ${reason}` : outcome });
      } catch {
        // Monitoring is best effort; the action was not taken either way.
      }
      return { executed: false, outcome, ...(reason && { reason }), ...(authorizationId && { authorizationId }) };
    };

    const key = request.idempotencyKey ?? `gate-${randomUUID()}`;
    const echoes = (used) => used?.authorized === true && used.authorizationId === authorizationId && used.tool === req.tool && used.action === req.action && same(used.resource, req.resource) && same(used.detail, req.detail);
    const act = async () => {
      let outcome = "success", result, error;
      try {
        result = await execute({ authorizationId });
      } catch (e) {
        outcome = "failure";
        error = "execution_failed";
        log(`  gate ${label} → authorized, but the action failed (${e?.name ?? "Error"})`);
      }
      try {
        await report({ ...req, outcome, authorizationId, ...(error && { error }) });
      } catch {
        // The authorization record shows it was spent; the missing report is itself visible to operators.
      }
      return { executed: true, outcome, result, authorizationId };
    };

    if (flow === "fast") {
      // 1. Ask, and when the policy allows it, have it authorized and spent in the same call. Retried only with the same key: a repeat of a
      //    request that was already spent is refused by TEND (409), so a lost answer can never make the action run twice.
      let first;
      for (let attempt = 0; ; attempt++) {
        try {
          first = await tend("/api/v1/authorize", req, { "Idempotency-Key": key });
          break;
        } catch (e) {
          if (e.status === 403 && e.body?.status === "denied") {
            authorizationId = e.body.id;
            const policyDenied = ["policy_denied", "no_policy", "invalid_policy", "missing_permission"].includes(e.body.reason);
            return stop("denied", e.body.reason, { outcome: "denied", ...(policyDenied && { policy: e.body.reason }) });
          }
          if (transient(e) && attempt < retries) { await sleep(retryMs); continue; }
          return { ...(await stop(transient(e) ? "unavailable" : "refused", e.code)), ...(why(e) && { detail: why(e) }) };
        }
      }
      authorizationId = first?.id;
      if (typeof authorizationId !== "string") return stop("refused", "unexpected_response");
      if (first.status === "consumed") return echoes({ ...first, authorizationId: first.id }) ? act() : stop("refused", "unexpected_response");
      if (first.status !== "pending") return stop("refused", "unexpected_response");

      // 2. A person decides. Only TEND's answer counts.
      log(`  gate ${label} → waiting for human approval (${authorizationId})`);
      await onPending?.(authorizationId);
      const deadline = Date.now() + approvalTimeoutMs;
      for (;;) {
        let st;
        try {
          st = await tend(`/api/v1/authorizations/${authorizationId}`);
        } catch (e) {
          if (!transient(e)) return stop("refused", e.code ?? "unexpected_response");
        }
        if (st?.status === "approved") break;
        if (st && st.status !== "pending") return stop(st.status === "rejected" ? "rejected" : st.status === "expired" ? "expired" : "refused", st.status, { outcome: st.status === "rejected" ? "denied" : "cancelled" });
        if (Date.now() >= deadline) {
          try { await tend(`/api/v1/authorizations/${authorizationId}/cancel`, {}); } catch { /* TEND expires it on its own */ }
          return stop("timeout", "no_decision");
        }
        await sleep(pollMs);
      }
      // 3. Spend it, once, right before acting. Never retried: after an ambiguous failure, ask again.
      let used;
      try {
        used = await tend(`/api/v1/authorizations/${authorizationId}/spend`, req);
      } catch (e) {
        const status = e.body?.status;
        if (status === "rejected") return stop("rejected", status, { outcome: "denied" });
        return { ...(await stop(transient(e) ? "unavailable" : "refused", e.code)), ...(why(e) && { detail: why(e) }) };
      }
      return echoes(used) ? act() : stop("refused", "unexpected_response");
    }

    // 1. Ask. Retried with the same idempotency key, so a lost response never creates a second request.
    let created;
    for (let attempt = 0; ; attempt++) {
      try {
        created = await tend("/api/v1/authorizations", req, { "Idempotency-Key": key });
        break;
      } catch (e) {
        if (e.status === 403 && e.body?.status === "denied") {
          authorizationId = e.body.id;
          const policyDenied = ["policy_denied", "no_policy", "invalid_policy", "missing_permission"].includes(e.body.reason);
          return stop("denied", e.body.reason, { outcome: "denied", ...(policyDenied && { policy: e.body.reason }) });
        }
        if (transient(e) && attempt < retries) {
          await sleep(retryMs);
          continue;
        }
        return { ...(await stop(transient(e) ? "unavailable" : "refused", e.code)), ...(why(e) && { detail: why(e) }) };
      }
    }
    authorizationId = created?.id;
    if (typeof authorizationId !== "string" || !["pending", "approved"].includes(created.status)) return stop("refused", "unexpected_response");

    // 2. If a human has to decide, wait. Only Tend's own answer counts; nothing the agent or model says does.
    if (created.status === "pending") {
      log(`  gate ${label} → waiting for human approval (${authorizationId})`);
      await onPending?.(authorizationId);
    }
    const deadline = Date.now() + approvalTimeoutMs;
    let token;
    for (;;) {
      try {
        const claim = await tend(`/api/v1/authorizations/${authorizationId}/token`, {});
        if (claim.status === "approved" && typeof claim.token === "string") {
          token = claim.token;
          break;
        }
        if (claim.status !== "pending") return stop("refused", "unexpected_response");
      } catch (e) {
        if (!transient(e)) {
          // Rejected, expired, cancelled, or the agent is no longer allowed: final.
          const status = e.body?.status ?? e.body?.reason ?? e.code;
          return stop(status === "rejected" ? "rejected" : status === "expired" ? "expired" : "refused", status, { outcome: status === "rejected" ? "denied" : "cancelled" });
        }
      }
      if (Date.now() >= deadline) {
        try {
          await tend(`/api/v1/authorizations/${authorizationId}/cancel`, {});
        } catch {
          // Tend expires it on its own; it can't be used without a token we never claimed.
        }
        return stop("timeout", "no_decision");
      }
      await sleep(pollMs);
    }

    // 3. Spend the token, once, right before acting. No retry: after an ambiguous failure ask again.
    let used;
    try {
      used = await tend(`/api/v1/authorizations/${authorizationId}/consume`, { token, ...req });
    } catch (e) {
      return { ...(await stop(transient(e) ? "unavailable" : "refused", e.code)), ...(why(e) && { detail: why(e) }) };
    } finally {
      token = undefined;
    }
    if (used?.authorized !== true || used.authorizationId !== authorizationId || used.tool !== req.tool || used.action !== req.action
      || !same(used.resource, req.resource) || !same(used.detail, req.detail)) return stop("refused", "unexpected_response");

    // 4. Act. Tend has authorized this action; whether it worked is reported separately, by us, from here.
    let outcome = "success", result, error;
    try {
      result = await execute({ authorizationId });
    } catch (e) {
      outcome = "failure";
      error = "execution_failed";
      log(`  gate ${label} → authorized, but the action failed (${e?.name ?? "Error"})`);
    }
    try {
      await report({ ...req, outcome, authorizationId, ...(error && { error }) });
    } catch {
      // The authorization record shows it was consumed; the missing report is itself visible to operators.
    }
    return { executed: true, outcome, result, authorizationId };
  }

  return { run };
}
