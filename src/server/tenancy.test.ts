// Workspaces: two accounts on one server see and change only their own agents, keys, policies, approvals and log. Every route that takes an
// id calls the same checks used here (routes.test.ts makes sure of that); an id from another workspace is answered exactly like one that
// does not exist. Agent API keys keep working as before and stay inside their workspace.
import assert from "node:assert/strict";
import { test } from "node:test";
import { passwordSignIn, register, setAccess, verifyEmail } from "./accounts.ts";
import { authAgent } from "./agent-auth.ts";
import { claimToken, requestAuthorization } from "./authz.ts";
import { memoryDb, type DB } from "./db.ts";
import { integrationStatus } from "./integrations.ts";
import { agentInWorkspace, assignCentralPolicy, centralInWorkspace, createCentralPolicy, keyPrefixes, listCentralPolicies, registerAgent, reviewInWorkspace, setPolicy } from "./repo.ts";
import { continueSample, startSample } from "./sample-agent.ts";
import { currentSession, revokeAll, sessionCookieName, sessionOverview, viewerOf } from "./session.ts";
import { snapshot } from "./sync.ts";
import { signedIn } from "./test-support.ts";

process.env.TEND_ADMIN_TOKEN = "t".repeat(8) + "0123456789abcdefghijklmnop";
process.env.TEND_DEMO = "0";
process.env.TEND_PUBLIC = "0";
process.env.TEND_TRUSTED_PROXY = "1";
delete process.env.TEND_ACCOUNTS;

let ipn = 0;
const post = () => new Request("http://tend.test/api/account/x", { method: "POST", headers: { host: "tend.test", "x-forwarded-for": `10.1.0.${++ipn % 250}` } });
const as = (value: string) => new Request("http://tend.test/api/v1/state", { headers: { host: "tend.test", cookie: `${sessionCookieName()}=${value}` } });
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const PW = "correct horse battery";

async function user(db: DB, email: string) {
  const r = await register(db, post(), { email, password: PW });
  await verifyEmail(db, post(), { token: /#token=([A-Za-z0-9_-]{43})/.exec(r.outbox[0].text)![1], password: PW });
  await setAccess(db, post(), (await db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", email))!.id, "approve", "admin");
  const s = await passwordSignIn(db, post(), { email, password: PW });
  const session = (await currentSession(db, as(s.value)))!;
  return { ...session, cookie: s.value };
}
const RULES = [{ tool: "send_email", action: "send", effect: "approve" }];

test("each account sees only its own workspace: agents, events, key prefixes, central policies, integration status", async () => {
  const db = await memoryDb();
  const a = await user(db, "a@example.com"), b = await user(db, "b@example.com");
  const admin = await signedIn(db);
  const ra = await registerAgent(db, { name: "Mailer", model: "m", provider: "Anthropic" }, a.id, a.workspace);
  const rb = await registerAgent(db, { name: "Mailer", model: "m", provider: "Anthropic" }, b.id, b.workspace);
  const rd = await registerAgent(db, { name: "Mailer", model: "m", provider: "Anthropic" }, admin.id);
  assert.match(ra.agent.id, /^mailer-[0-9a-f]{6}$/, "a user's agent id says nothing about other workspaces' names");
  assert.equal(rd.agent.id, "mailer");
  const view = async (cookie: string) => (await snapshot(db, await viewerOf(db, as(cookie)))).projection.agents.map((x) => x.id).sort();
  assert.deepEqual(await view(a.cookie), [ra.agent.id]);
  assert.deepEqual(await view(b.cookie), [rb.agent.id]);
  assert.deepEqual(await view(admin.value), ["mailer"], "the admin works in the default workspace and does not see users' agents either");
  assert.deepEqual(Object.keys(await keyPrefixes(db, a.workspace)), [ra.agent.id]);
  await createCentralPolicy(db, { name: "Baseline", rules: RULES }, a.id, a.workspace);
  await createCentralPolicy(db, { name: "Baseline", rules: RULES }, b.id, b.workspace); // the same name in another workspace is fine
  assert.equal((await listCentralPolicies(db, a.workspace)).length, 1);
  assert.equal((await listCentralPolicies(db)).length, 0, "the default workspace has none");
  const status = await integrationStatus(db, a.workspace);
  assert.deepEqual(status.providers.Anthropic.map((x) => x.id), [ra.agent.id]);
  await db.close();
});

test("an id from another workspace is not found: agents, approvals, central policies, assignments, the sample agent", async () => {
  const db = await memoryDb();
  const a = await user(db, "a@example.com"), b = await user(db, "b@example.com");
  const ra = await registerAgent(db, { name: "Mailer", model: "m", provider: "Custom" }, a.id, a.workspace);
  await setPolicy(db, ra.agent.id, RULES, "enforce");
  const agent = (await authAgent(db, new Request("http://tend.test/api/v1/authorizations", { headers: { authorization: `Bearer ${ra.apiKey}` } })))!;
  const { view } = await requestAuthorization(db, agent, { tool: "send_email", action: "send", resource: "r1" }, null);
  assert.equal(view.status, "pending");

  await agentInWorkspace(db, a.workspace, ra.agent.id);
  const notMine = await code(agentInWorkspace(db, b.workspace, ra.agent.id));
  assert.equal(notMine, "agent_not_found");
  assert.equal(await code(agentInWorkspace(db, b.workspace, "no-such-agent")), notMine, "indistinguishable from an id that does not exist");
  await reviewInWorkspace(db, a.workspace, view.id);
  assert.equal(await code(reviewInWorkspace(db, b.workspace, view.id)), "review_not_found");
  assert.equal(await code(reviewInWorkspace(db, b.workspace, "az_nothing")), "review_not_found");

  const pa = await createCentralPolicy(db, { name: "A rules", rules: RULES }, a.id, a.workspace);
  const pb = await createCentralPolicy(db, { name: "B rules", rules: RULES }, b.id, b.workspace);
  assert.equal(await code(centralInWorkspace(db, b.workspace, pa.id)), "central_policy_not_found");
  assert.equal(await code(assignCentralPolicy(db, pb.id, { assign: [ra.agent.id] }, b.id)), "agent_not_found", "B's policy cannot be put on A's agent");
  assert.equal(await code(assignCentralPolicy(db, pa.id, { assign: [ra.agent.id] }, a.id)), "ok");

  const steps = await startSample(db, a.id, a.workspace);
  assert.deepEqual(await continueSample(db, steps.map((s) => s.id), false, b.workspace), [], "B cannot read A's sample run");
  assert.equal((await continueSample(db, steps.map((s) => s.id), false, a.workspace)).length, 3);
  await db.close();
});

test("agent keys are a separate credential: they work without any user session, and a key never acts in another workspace", async () => {
  const db = await memoryDb();
  const a = await user(db, "a@example.com");
  const ra = await registerAgent(db, { name: "Bot", model: "m", provider: "Custom" }, a.id, a.workspace);
  await setPolicy(db, ra.agent.id, [{ tool: "read", action: "run", effect: "allow" }], "enforce");
  const keyReq = new Request("http://tend.test/api/v1/authorizations", { headers: { authorization: `Bearer ${ra.apiKey}` } });
  const agent = (await authAgent(db, keyReq))!;
  const { view } = await requestAuthorization(db, agent, { tool: "read", action: "run" }, null);
  assert.equal(view.status, "approved");
  assert.equal((await claimToken(db, agent, view.id)).view.status, "approved");
  assert.equal(await viewerOf(db, keyReq).then((v) => v.role), "visitor", "an agent key is not a user session");
  assert.equal(await currentSession(db, keyReq), undefined);
  await db.close();
});

test("sessions are per account: a user sees and ends only their own, the admin only the admin-token ones", async () => {
  const db = await memoryDb();
  const a = await user(db, "a@example.com"), b = await user(db, "b@example.com");
  const admin = await signedIn(db);
  const overview = await sessionOverview(db, a);
  assert.deepEqual(overview.sessions.map((s) => s.id), [a.id]);
  assert.ok(overview.recent.length > 0 && overview.recent.every((e) => e.sessionId !== b.id), "A's log has nothing of B's");
  assert.equal(await revokeAll(db, a), 1);
  assert.equal(await currentSession(db, as(a.cookie)), undefined);
  assert.ok(await currentSession(db, as(b.cookie)), "B is still signed in");
  assert.ok(await currentSession(db, as(admin.value)), "so is the admin");
  const adminView = await sessionOverview(db, (await currentSession(db, as(admin.value)))!);
  assert.deepEqual(adminView.sessions.map((s) => s.id), [admin.id]);
  await db.close();
});

test("a private server shows nothing to someone who is not signed in", async () => {
  const db = await memoryDb();
  const v = await viewerOf(db, new Request("http://tend.test/api/v1/state"));
  assert.equal(v.role, "visitor");
  assert.equal(await code(snapshot(db, v)), "sign_in_required");
  await db.close();
});

test("disabling an account also stops its agents: every key of the workspace is revoked and anything waiting is cancelled", async () => {
  const db = await memoryDb();
  const a = await user(db, "a@example.com"), b = await user(db, "b@example.com");
  const ra = await registerAgent(db, { name: "Bot", model: "m", provider: "Custom" }, a.id, a.workspace);
  const rb = await registerAgent(db, { name: "Bot", model: "m", provider: "Custom" }, b.id, b.workspace);
  await setPolicy(db, ra.agent.id, RULES, "enforce");
  const keyReq = (k: string) => new Request("http://tend.test/api/v1/agent/inbox", { headers: { authorization: `Bearer ${k}` } });
  const agent = (await authAgent(db, keyReq(ra.apiKey)))!;
  const { view } = await requestAuthorization(db, agent, { tool: "send_email", action: "send", resource: "r" }, null);
  await setAccess(db, post(), (await db.get<{ id: string }>("SELECT id FROM users WHERE email = 'a@example.com'"))!.id, "disable", "admin");
  assert.equal(await code(authAgent(db, keyReq(ra.apiKey))), "invalid_key");
  assert.equal((await db.get<{ status: string }>("SELECT status FROM authorizations WHERE id = ?", view.id))!.status, "cancelled");
  assert.ok(await authAgent(db, keyReq(rb.apiKey)), "B's agent is untouched");
  await db.close();
});

// From the security review of 2026-10-31: the dashboard's first load read the latest 12,000 events of the whole server and then kept the
// viewer's, so one busy (or hostile) workspace could push another's waiting approvals out of its dashboard.
test("another workspace's volume never pushes your waiting approval out of your dashboard", async () => {
  const db = await memoryDb();
  const a = await user(db, "a@example.com"), b = await user(db, "b@example.com");
  const ra = await registerAgent(db, { name: "Mailer", model: "m", provider: "Anthropic" }, a.id, a.workspace);
  const rb = await registerAgent(db, { name: "Noisy", model: "m", provider: "Anthropic" }, b.id, b.workspace);
  await setPolicy(db, ra.agent.id, RULES, "enforce");
  const agent = (await authAgent(db, new Request("http://tend.test/api/v1/authorize", { headers: { authorization: `Bearer ${ra.apiKey}` } })))!;
  const { view } = await requestAuthorization(db, agent, { tool: "send_email", action: "send", resource: "r1" }, null);
  assert.equal(view.status, "pending");
  const now = Date.now();
  await db.exec(`INSERT INTO events (id, agent_id, type, at, actor, data) SELECT 'flood_' || g, '${rb.agent.id}', 'agent.heartbeat', ${now} + g, 'agent', '{}' FROM generate_series(1, 12500) AS g`);
  const mine = await snapshot(db, await viewerOf(db, as(a.cookie)), now + 20_000);
  assert.ok(mine.projection.authorizations.some((x) => x.id === view.id && x.status === "pending"), "the waiting request is still on the dashboard");
});
