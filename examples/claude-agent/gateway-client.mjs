// The agent's only way to run a gateway tool: ask Tend, wait if a person must decide, then POST execute.
// Tend holds the filesystem (or other credential) and runs the tool. This file never imports `fs`.
//
// Fail closed: a timeout, a network error, a 4xx/5xx, a malformed answer or an unexpected body all end in
// "do not assume it ran". Creating a request is retried (it is idempotent); execute never is.
import { randomUUID } from "node:crypto";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const transient = (e) => !e.status || e.status >= 500;

export function createGateway({ tend, approvalTimeoutMs = 120_000, pollMs = 2_000, retries = 2, retryMs = 500, onPending, log = () => {} }) {
  /**
   * @param tool  allowlisted gateway tool name
   * @param params  exact params the gateway will bind and, if approved, run
   */
  async function run(tool, params) {
    const label = `${tool}`;
    let authorizationId;

    const stop = (outcome, reason) => {
      log(`  gateway ${label} → not executed (${outcome}${reason ? `: ${reason}` : ""})`);
      return { executed: false, outcome, ...(reason && { reason }), ...(authorizationId && { authorizationId }) };
    };

    const key = `gw-${randomUUID()}`;
    let created;
    for (let attempt = 0; ; attempt++) {
      try {
        created = await tend("/api/v1/gateway/requests", { tool, params }, { "Idempotency-Key": key });
        break;
      } catch (e) {
        if (e.status === 403 && e.body?.status === "denied") {
          authorizationId = e.body.id;
          return stop("denied", e.body.reason);
        }
        if (transient(e) && attempt < retries) {
          await sleep(retryMs);
          continue;
        }
        return stop(transient(e) ? "unavailable" : "refused", e.code);
      }
    }
    authorizationId = created?.id;
    if (typeof authorizationId !== "string" || !["pending", "approved"].includes(created.status)) return stop("refused", "unexpected_response");

    if (created.status === "pending") {
      log(`  gateway ${label} → waiting for human approval (${authorizationId})`);
      await onPending?.({ authorizationId, tool, params, resource: created.resource, detail: created.detail });
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
          const status = e.body?.status ?? e.body?.reason ?? e.code;
          return stop(status === "rejected" ? "rejected" : status === "expired" ? "expired" : "refused", status);
        }
      }
      if (Date.now() >= deadline) {
        try {
          await tend(`/api/v1/authorizations/${authorizationId}/cancel`, {});
        } catch {
          // Tend expires it on its own.
        }
        return stop("timeout", "no_decision");
      }
      await sleep(pollMs);
    }

    let used;
    try {
      used = await tend("/api/v1/gateway/execute", { authorizationId, token, tool, params });
    } catch (e) {
      return stop(transient(e) ? "unavailable" : e.code === "already_consumed" ? "replay" : "refused", e.code);
    } finally {
      token = undefined;
    }
    if (used?.executed !== true || used.authorizationId !== authorizationId || used.tool !== tool) return stop("refused", "unexpected_response");
    log(`  gateway ${label} → executed`);
    return { executed: true, outcome: "success", result: used.result, authorizationId };
  }

  return { run };
}
