// Every API handler must be classified, and must call the guard its class requires. A new route or method that is not
// listed here fails the test, so an unguarded handler cannot ship by accident. This is a static check of the source:
// it proves the guard is called in the handler, not that the guard is correct (that is tested in audit.test.ts and
// server.test.ts, and end to end by scripts/authz-e2e.mjs).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.join(import.meta.dirname, "..", "app", "api");

/**
 * operator: a signed session and same-site origin. admin: the admin-token session only. agent: an API key. viewer: visitor-or-operator reads,
 * rate limited. account: no session yet (sign-up, sign-in, links from mails), so same-site only, with limits and uniform answers in accounts.ts.
 * public: no data of value.
 */
const GUARD = { operator: "await requireOperator(", admin: "await requireAdmin(", agent: "authAgent(", viewer: "await viewerOf(", account: "requireSameSite(req)", public: "" } as const;
const EXPECTED: Record<string, keyof typeof GUARD> = {
  "health:GET": "public",
  "operator/session:GET": "viewer",
  "operator/session:POST": "public", // exchanges the admin token for a session; failures are limited per trusted address and logged (signin.ts)
  "operator/session:DELETE": "public", // ends the caller's own session, and only with that session's own secret
  "operator/sessions:GET": "operator",
  "operator/sessions:DELETE": "operator",
  "v1/state:GET": "viewer",
  "v1/events:GET": "viewer",
  "v1/events:POST": "agent",
  "v1/check-ins:GET": "public", // the protocol description, no data
  "v1/check-ins:POST": "agent",
  "v1/agent/inbox:GET": "agent",
  "v1/authorizations:POST": "agent",
  "v1/authorizations/[id]:GET": "agent",
  "v1/authorizations/[id]/token:POST": "agent",
  "v1/authorizations/[id]/consume:POST": "agent",
  "v1/authorizations/[id]/cancel:POST": "agent",
  "v1/authorize:POST": "agent",
  "v1/authorizations/[id]/spend:POST": "agent",
  "v1/gateway/requests:POST": "agent",
  "v1/gateway/execute:POST": "agent",
  "v1/agents:POST": "operator",
  "v1/agents/[id]/policy:GET": "operator",
  "v1/agents/[id]/verification:GET": "operator",
  "v1/agents/[id]/verification:POST": "operator",
  "v1/agents/[id]/policy:POST": "operator",
  "v1/agents/[id]/control:POST": "operator",
  "v1/agents/[id]/keys:POST": "operator",
  "v1/agents/[id]/keys:DELETE": "operator",
  "v1/agents/[id]/check-in-requests:POST": "operator",
  "v1/integrations/status:GET": "operator",
  "v1/central-policies:GET": "operator",
  "v1/central-policies:POST": "operator",
  "v1/central-policies/[id]:POST": "operator",
  "v1/central-policies/[id]/assignments:POST": "operator",
  "v1/reviews/[id]:POST": "operator",
  "v1/sample-agent:POST": "operator",
  "v1/policy-simulations:POST": "operator",
  "v1/onboarding:GET": "operator",
  "v1/onboarding:POST": "operator",
  "v1/notifications:GET": "operator",
  "v1/notifications/read:POST": "operator",
  "v1/notifications/preferences:GET": "operator",
  "v1/notifications/preferences:POST": "operator",
  "v1/notifications/subscriptions:POST": "operator",
  "v1/notifications/subscriptions:DELETE": "operator",
  "v1/notifications/test:POST": "operator",
  "v1/demo/reset:POST": "admin",
  "v1/demo/check-ins:POST": "admin",
  "account/register:POST": "account",
  "account/verify:POST": "account",
  "account/resend:POST": "account",
  "account/sign-in:POST": "account",
  "account/forgot:POST": "account",
  "account/reset:POST": "account",
  "admin/users:GET": "admin",
  "admin/audit:GET": "admin",
  "admin/users/[id]:POST": "admin",
};

function handlers() {
  const out: { key: string; body: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "route.ts") {
        const src = readFileSync(full, "utf8");
        const rel = path.relative(ROOT, path.dirname(full)).split(path.sep).join("/");
        const parts = src.split(/^export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) =/m); // [prelude, METHOD, body, METHOD, body, …]
        for (let i = 1; i < parts.length; i += 2) out.push({ key: `${rel}:${parts[i]}`, body: parts[i + 1] });
        assert.equal(/export (async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(src), false, `${rel}: export handlers as \`export const METHOD = route(...)\` so this test can read them`);
      }
    }
  };
  walk(ROOT);
  return out;
}

test("every API handler is classified, and calls the guard its class requires", () => {
  const found = handlers();
  assert.ok(found.length >= Object.keys(EXPECTED).length);
  const keys = found.map((h) => h.key).sort();
  assert.deepEqual(keys, Object.keys(EXPECTED).sort(), "a route or method was added or removed: classify it in EXPECTED");
  for (const h of found) {
    const need = GUARD[EXPECTED[h.key]];
    assert.ok(h.body.includes(need), `${h.key} must call ${need || "nothing"}`);
  }
});

test("operator routes never take an agent key as authority, and agent routes never take an operator session", () => {
  for (const h of handlers()) {
    const cls = EXPECTED[h.key];
    if (cls === "operator") assert.equal(h.body.includes("authAgent("), false, `${h.key}: an operator route must not accept an agent key as authority`);
    if (cls === "agent") assert.equal(/requireOperator\(|isOperator\(|operatorSid\(/.test(h.body), false, `${h.key}: an agent route must not accept an operator session`);
  }
});

test("operator routes stay inside the caller's workspace: an id in the path is checked first, and lists and new things use the workspace", () => {
  for (const h of handlers()) {
    if (EXPECTED[h.key] !== "operator") continue;
    const path = h.key.split(":")[0];
    if (/\/\[id\]/.test(path)) {
      const check = path.startsWith("v1/agents/") ? "agentInWorkspace(" : path.startsWith("v1/reviews/") ? "reviewInWorkspace(" : path.startsWith("v1/central-policies/") ? "centralInWorkspace(" : "?";
      const at = h.body.indexOf(check);
      assert.ok(at > 0, `${h.key} must call ${check}`);
      // Nothing that reads or changes the object may come before the check.
      assert.ok(!/\b(control|setPolicy|policyView|rotateKey|revokeKey|requestCheckIn|runVerification|latestVerification|decide|updateCentralPolicy|assignCentralPolicy)\(/.test(h.body.slice(0, at)), `${h.key}: the workspace check must come first`);
    }
    for (const fn of ["registerAgent(", "listCentralPolicies(", "createCentralPolicy(", "startSample(", "continueSample(", "integrationStatus(", "simulatePolicy("])
      for (const line of h.body.split("\n").filter((l) => l.includes(fn))) assert.match(line, /workspace\)/, `${h.key}: ${fn} must be given the caller's workspace`);
  }
});
