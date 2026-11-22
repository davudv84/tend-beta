// Two tenants on real PostgreSQL. tenancy.test.ts proves workspace isolation on the embedded database (one connection); this file proves the
// same boundaries with a real connection pool, where requests from both tenants truly overlap. Two accounts sign up, confirm and sign in exactly
// as people do; then every check a route makes before touching an id is tried with the other tenant's ids, and both tenants' agents work at
// the same time without seeing or spending each other's approvals.
//
// Skipped unless TEND_TEST_DATABASE_URL points at a PostgreSQL server on this machine (CI sets it; scripts/ci/test-gate.mjs fails CI if these
// are skipped there). Each test creates its own database with a random name and drops it afterwards.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { passwordSignIn, register, setAccess, verifyEmail } from "./accounts.ts";
import { authAgent } from "./agent-auth.ts";
import { authorizationStatus, cancelAuthorization, claimToken, consumeAuthorization, requestAuthorization, spendApproved } from "./authz.ts";
import { migrate, postgres, type DB } from "./db.ts";
import { agentInWorkspace, assignCentralPolicy, centralInWorkspace, createCentralPolicy, decide, keyPrefixes, listCentralPolicies, registerAgent, reviewInWorkspace, setPolicy } from "./repo.ts";
import { currentSession, sessionCookieName, viewerOf } from "./session.ts";
import { snapshot } from "./sync.ts";

process.env.TEND_ADMIN_TOKEN = `fake_admin_${randomBytes(24).toString("hex")}`;
process.env.TEND_DEMO = "0";
process.env.TEND_PUBLIC = "0";
process.env.TEND_TRUSTED_PROXY = "1";
delete process.env.TEND_ACCOUNTS;

const URL_ = process.env.TEND_TEST_DATABASE_URL ?? "";
const skip = URL_ ? false : "set TEND_TEST_DATABASE_URL (or run `npm run test:postgres`) to test against real PostgreSQL";

async function tempDb() {
  const host = new URL(URL_).hostname;
  if (!["127.0.0.1", "localhost", "[::1]", "::1", ""].includes(host)) throw new Error(`TEND_TEST_DATABASE_URL must point at this machine, not ${host}`);
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  const name = `tend_tenancy_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(URL_);
  u.pathname = `/${name}`;
  const db = await postgres(u.toString());
  await migrate(db);
  return { db, close: async () => { await db.close(); await admin.query(`DROP DATABASE ${name} WITH (FORCE)`); await admin.end(); } };
}

let ipn = 0;
const post = () => new Request("http://tend.test/api/account/x", { method: "POST", headers: { host: "tend.test", "x-forwarded-for": `10.2.0.${++ipn % 250}` } });
const as = (value: string) => new Request("http://tend.test/api/v1/state", { headers: { host: "tend.test", cookie: `${sessionCookieName()}=${value}` } });
const keyed = (key: string) => new Request("http://tend.test/api/v1/authorizations", { headers: { authorization: `Bearer ${key}` } });
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const PW = "correct horse battery";
const RULES = [{ tool: "send_email", action: "send", effect: "approve" }];
const REQ = { tool: "send_email", action: "send", resource: "r1" };

/** A person: sign-up, the confirmation link, approval, sign-in. Returns their server-side session. */
async function person(db: DB, email: string) {
  const r = await register(db, post(), { email, password: PW });
  await verifyEmail(db, post(), { token: /#token=([A-Za-z0-9_-]{43})/.exec(r.outbox[0].text)![1], password: PW });
  await setAccess(db, post(), (await db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", email))!.id, "approve", "admin");
  const s = await passwordSignIn(db, post(), { email, password: PW });
  return { ...(await currentSession(db, as(s.value)))!, cookie: s.value };
}

/** A tenant: a person and an agent with an approval rule, plus the agent as its key authenticates it. */
async function tenant(db: DB, email: string) {
  const p = await person(db, email);
  const reg = await registerAgent(db, { name: "Mailer", model: "m", provider: "Custom" }, p.id, p.workspace);
  await setPolicy(db, reg.agent.id, RULES, "enforce");
  const agent = (await authAgent(db, keyed(reg.apiKey)))!;
  return { ...p, agentId: reg.agent.id, key: reg.apiKey, agent };
}

test("PostgreSQL, two tenants: each sees only its own agents, approvals, key prefixes and central policies", { skip }, async () => {
  const { db, close } = await tempDb();
  try {
    const a = await tenant(db, "a@example.com"), b = await tenant(db, "b@example.com");
    assert.notEqual(a.workspace, b.workspace);
    await requestAuthorization(db, a.agent, REQ, null);
    const view = async (cookie: string) => (await snapshot(db, await viewerOf(db, as(cookie)))).projection;
    const va = await view(a.cookie), vb = await view(b.cookie);
    assert.deepEqual(va.agents.map((x) => x.id), [a.agentId]);
    assert.deepEqual(vb.agents.map((x) => x.id), [b.agentId]);
    assert.equal(va.authorizations.length, 1);
    assert.equal(vb.authorizations.length, 0, "B sees nothing of A's waiting request");
    assert.deepEqual(Object.keys(await keyPrefixes(db, a.workspace)), [a.agentId]);
    await createCentralPolicy(db, { name: "Baseline", rules: RULES }, a.id, a.workspace);
    assert.equal((await listCentralPolicies(db, b.workspace)).length, 0);
  } finally {
    await close();
  }
});

test("PostgreSQL, two tenants: every id of the other tenant is answered exactly like one that does not exist", { skip }, async () => {
  const { db, close } = await tempDb();
  try {
    const a = await tenant(db, "a@example.com"), b = await tenant(db, "b@example.com");
    const { view } = await requestAuthorization(db, a.agent, REQ, null);
    assert.equal(await code(agentInWorkspace(db, b.workspace, a.agentId)), await code(agentInWorkspace(db, b.workspace, "no-such-agent")));
    assert.equal(await code(agentInWorkspace(db, b.workspace, a.agentId)), "agent_not_found");
    assert.equal(await code(reviewInWorkspace(db, b.workspace, view.id)), "review_not_found");
    assert.equal(await code(reviewInWorkspace(db, a.workspace, view.id)), "ok");
    const pa = await createCentralPolicy(db, { name: "A rules", rules: RULES }, a.id, a.workspace);
    const pb = await createCentralPolicy(db, { name: "B rules", rules: RULES }, b.id, b.workspace);
    assert.equal(await code(centralInWorkspace(db, b.workspace, pa.id)), "central_policy_not_found");
    assert.equal(await code(assignCentralPolicy(db, pb.id, { assign: [a.agentId] }, b.id)), "agent_not_found", "B's policy cannot be put on A's agent");
  } finally {
    await close();
  }
});

test("PostgreSQL, two tenants: an agent key never reads, claims, spends, consumes or cancels the other tenant's authorization", { skip }, async () => {
  const { db, close } = await tempDb();
  try {
    const a = await tenant(db, "a@example.com"), b = await tenant(db, "b@example.com");
    const { view } = await requestAuthorization(db, a.agent, REQ, null);
    await decide(db, view.id, "approved", undefined, a.id);
    for (const [what, attempt] of [
      ["status", () => authorizationStatus(db, b.agent, view.id)],
      ["claim", () => claimToken(db, b.agent, view.id)],
      ["spend", () => spendApproved(db, b.agent, view.id, REQ)],
      ["consume", () => consumeAuthorization(db, b.agent, view.id, { ...REQ, token: `tend_az_${"a".repeat(43)}` })],
      ["cancel", () => cancelAuthorization(db, b.agent, view.id)],
    ] as const) assert.equal(await code(attempt()), "authorization_not_found", `B's agent: ${what}`);
    assert.equal((await authorizationStatus(db, a.agent, view.id)).status, "approved", "A's approval is untouched");
    assert.equal(await code(spendApproved(db, a.agent, view.id, REQ)), "ok", "and A's own agent can still spend it, once");
  } finally {
    await close();
  }
});

test("PostgreSQL, two tenants at once: overlapping spends from both agents each consume only their own approval, exactly once", { skip }, async () => {
  const { db, close } = await tempDb();
  try {
    const a = await tenant(db, "a@example.com"), b = await tenant(db, "b@example.com");
    await Promise.all(Array.from({ length: 4 }, () => db.get("SELECT pg_sleep(0.15)"))); // open every pool connection, so the race is real
    const ia = (await requestAuthorization(db, a.agent, REQ, null)).view.id;
    const ib = (await requestAuthorization(db, b.agent, REQ, null)).view.id;
    await decide(db, ia, "approved", undefined, a.id);
    await decide(db, ib, "approved", undefined, b.id);
    // Each agent fires at its own approval and at the other's, all at once.
    const attempts = [
      ...Array.from({ length: 6 }, () => ["A→A", spendApproved(db, a.agent, ia, REQ)] as const),
      ...Array.from({ length: 6 }, () => ["B→B", spendApproved(db, b.agent, ib, REQ)] as const),
      ...Array.from({ length: 6 }, () => ["A→B", spendApproved(db, a.agent, ib, REQ)] as const),
      ...Array.from({ length: 6 }, () => ["B→A", spendApproved(db, b.agent, ia, REQ)] as const),
    ];
    const results = await Promise.all(attempts.map(async ([who, p]) => [who, await code(p)] as const));
    const wins = (who: string) => results.filter(([w, c]) => w === who && c === "ok").length;
    assert.equal(wins("A→A"), 1);
    assert.equal(wins("B→B"), 1);
    assert.equal(wins("A→B") + wins("B→A"), 0, "no cross-tenant spend ever succeeds");
    assert.ok(results.filter(([w]) => w === "A→B" || w === "B→A").every(([, c]) => c === "authorization_not_found"));
    const consumed = await db.all<{ id: string; agent_id: string }>("SELECT id, agent_id FROM authorizations WHERE status = 'consumed' ORDER BY agent_id");
    assert.deepEqual(consumed.map((r) => [r.id, r.agent_id]).sort(), [[ia, a.agentId], [ib, b.agentId]].sort());
  } finally {
    await close();
  }
});
