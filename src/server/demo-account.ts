// The shared, read-only demo account (config.demoAccount, TEND_DEMO_ACCOUNT). The first sign-in with its address creates it: confirmed,
// approved and read_only, so the server refuses every change it asks for (http.ts requireOperator), in a workspace of its own that holds
// SAMPLE agents only. Each is named "(sample)" and has no API key at all, so nothing outside this file can act as one. Their requests go
// through TEND's real decision path (requestAuthorization, decide, spendApproved, ingestEvents): the dashboard shows what TEND records for a
// real agent; only the actions never existed. Nothing here runs a tool or reaches outside the database.
// The workspace stays current without a background job: a read of it tops the activity up at most every few minutes (sync.ts).
import { randomUUID } from "node:crypto";
import { presetRules, TEST_COMMANDS } from "../lib/agent-presets.ts";
import type { Agent, Provider } from "../lib/types";
import { requestAuthorization, spendApproved } from "./authz.ts";
import { config } from "./config.ts";
import type { DB } from "./db.ts";
import { allAgents, control, decide, getAgent, ingestEvents, insertAgent, insertEvent, setPolicy } from "./repo.ts";
import { audit } from "./session.ts";

type Ask = { tool: string; action: string; detail: string; resource?: string; args?: Record<string, string> };
const run = (command: string): Ask => ({ tool: "shell", action: "Bash", detail: `Run: ${command}`, args: { command } });
const edit = (path: string): Ask => ({ tool: "file.write", action: "Edit", detail: `Change: ${path}`, args: { path } });
const read = (path: string): Ask => ({ tool: "file.read", action: "Read", detail: `Read: ${path}`, args: { path } });
const open = (url: string): Ask => ({ tool: "web", action: "WebFetch", detail: `Open: ${url}`, args: { url } });
const ask = (tool: string, action: string, resource: string, detail: string): Ask => ({ tool, action, resource, detail });
const rule = (tool: string, effect: "allow" | "approve" | "deny") => ({ tool, action: "*", effect });

/** What each sample agent asks for, grouped by what its rules are expected to say. The real policy decides; the groups only pick what to ask. */
interface Sample { name: string; model: string; provider: Provider; role: string; rules: unknown[]; allow: Ask[]; approve: Ask[]; deny: Ask[]; pause?: string }
const SAMPLES: Sample[] = [
  {
    name: "Claude Code · checkout-service (sample)", model: "Claude Code", provider: "Anthropic", role: "Coding assistant · sample data",
    rules: presetRules("balanced"),
    allow: [run("npm test"), run("git status"), run("git diff --stat"), edit("src/checkout/discounts.ts"), edit("src/checkout/discounts.test.ts"), read("README.md"), run("npm run lint")],
    approve: [run("git push origin feature/discount-codes"), run("curl -s https://api.example.com/v1/rates"), edit(".env.local"), open("https://docs.example.com/payments/refunds")],
    deny: [run("cat ~/.ssh/id_ed25519"), run("rm -rf / --no-preserve-root")],
  },
  {
    name: "Support agent (sample)", model: "OpenAI Agents SDK", provider: "OpenAI", role: "Customer support · sample data",
    rules: [rule("lookup_order", "allow"), rule("draft_reply", "allow"), rule("issue_refund", "approve"), rule("delete_customer", "deny")],
    allow: [ask("lookup_order", "read", "order-48213", "Look up order #48213"), ask("draft_reply", "write", "ticket-9921", "Draft a reply to ticket #9921 about a late delivery"), ask("lookup_order", "read", "order-48231", "Look up order #48231")],
    approve: [ask("issue_refund", "refund", "order-48213", "Refund €42.00 to the card used for order #48213"), ask("issue_refund", "refund", "order-48190", "Refund €18.50 to the card used for order #48190")],
    deny: [ask("delete_customer", "delete", "customer-5521", "Delete customer record #5521")],
  },
  {
    name: "Research agent (sample)", model: "LangGraph", provider: "Anthropic", role: "Weekly research brief · sample data",
    rules: [rule("web_search", "allow"), rule("read_paper", "allow"), rule("send_email", "approve"), rule("publish_post", "deny")],
    allow: [ask("web_search", "search", "grid-storage", "Search: grid-scale battery storage costs"), ask("read_paper", "read", "paper-17", "Read paper 17 of the reading list")],
    approve: [ask("send_email", "send", "team-mailing-list", "Email the weekly brief to team@example.com")],
    deny: [ask("publish_post", "publish", "company-blog", "Publish the brief on the company blog")],
  },
  {
    name: "Nightly data sync (sample)", model: "HTTP API", provider: "Custom", role: "Warehouse sync · sample data",
    rules: [rule("read_table", "allow"), rule("export_table", "approve"), rule("drop_table", "deny")],
    allow: [ask("read_table", "read", "orders", "Read table orders (last 24 hours)")],
    approve: [ask("export_table", "export", "customers", "Export table customers to the analytics bucket")],
    deny: [ask("drop_table", "delete", "orders_staging", "Drop table orders_staging")],
    pause: "Paused while a schema change is reviewed (sample)",
  },
];

const S = 1000, MIN = 60 * S;
const EVERY = 3 * MIN; // how often a read may top the activity up
const NOTE = "Sample decision";
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

const report = (db: DB, agent: Agent, ask: Ask, id: string, at: number) =>
  ingestEvents(db, agent, [{ type: "tool.called", data: { tool: ask.tool, action: ask.action, ...(ask.resource && { resource: ask.resource }), detail: ask.detail, outcome: "success", authorizationId: id } }], at);

/**
 * One request, the way a hook or SDK agent makes it: allowed ones run and are reported, refused ones never run, held ones wait for a person.
 * `person` is what the sample reviewer does with a held one: approve (then it runs once), reject, or nothing (it waits, then expires).
 */
async function act(db: DB, agent: Agent, ask: Ask, at: number, person: "approve" | "reject" | "nothing") {
  const { view } = await requestAuthorization(db, agent, ask, null, at, { spend: true });
  if (view.status === "consumed") return report(db, agent, ask, view.id, at + 3 * S);
  if (view.status !== "pending" || person === "nothing") return;
  await decide(db, view.id, person === "approve" ? "approved" : "rejected", NOTE, undefined, at + 50 * S);
  if (person === "approve") {
    await spendApproved(db, agent, view.id, ask, at + 54 * S);
    await report(db, agent, ask, view.id, at + 57 * S);
  }
}

/** The sample agents and about six hours of history, in time order. */
async function seed(db: DB, workspace: string, now: number) {
  const start = now - 6 * 60 * MIN;
  const agents: { s: Sample; a: Agent }[] = [];
  for (const s of SAMPLES) {
    const base = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const a: Agent = {
      id: `${base}-${randomUUID().slice(0, 6)}`, name: s.name, model: s.model, provider: s.provider, role: s.role, description: "Sample agent in the TEND demo. It is not connected to anything.",
      status: "active", integrationEnabled: true, permissions: [], cadenceHours: 0, connectedAt: start, origin: "connected", configVersion: 1, ackedVersion: 0, public: false,
    };
    await db.tx(async (q) => {
      await q.lockEvents();
      await insertAgent(q, a, undefined, undefined, workspace); // no key: nothing can authenticate as a sample agent
      await insertEvent(q, { agentId: a.id, type: "agent.registered", actor: "human", at: start, data: { agent: a } });
    });
    await setPolicy(db, a.id, s.rules, "enforce");
    agents.push({ s, a: (await getAgent(db, a.id))! });
  }
  const [claude, support, research, sync] = agents;
  // Claude Code's protection test, as the setup guide runs it: the activity test runs, the blocked one is refused, the approval one is approved and runs.
  let t = start + 4 * MIN;
  await act(db, claude.a, run(TEST_COMMANDS.activity), t, "approve");
  await act(db, claude.a, run(TEST_COMMANDS.blocked), (t += MIN), "approve");
  await act(db, claude.a, run(TEST_COMMANDS.approval), (t += MIN), "approve");
  // Then a working day: mostly allowed calls, some held for a person (approved, rejected, or left to expire) and a few refused.
  const people: ("approve" | "reject" | "nothing")[] = ["approve", "approve", "reject", "approve", "nothing"];
  const order = [claude, support, claude, research, support, claude, sync, claude, support, research];
  for (let i = 0; t < now - 15 * MIN; i++) {
    t += Math.round((8 + Math.random() * 8) * MIN); // about 25 calls: the first sign-in waits for all of them
    const { s, a } = order[i % order.length];
    const roll = i % 7;
    if (roll === 3) await act(db, a, pick(s.approve), t, people[i % people.length]);
    else if (roll === 5) await act(db, a, pick(s.deny), t, "nothing");
    else await act(db, a, pick(s.allow), t, "nothing");
  }
  // An approved refund the agent then tried to carry out for ten times the amount: TEND refuses it and raises an alert.
  const refund = support.s.approve[0];
  const { view } = await requestAuthorization(db, support.a, refund, null, now - 12 * MIN, { spend: true });
  await decide(db, view.id, "approved", NOTE, undefined, now - 11 * MIN);
  await spendApproved(db, support.a, view.id, { ...refund, detail: refund.detail.replace("€42.00", "€420.00") }, now - 11 * MIN + 5 * S).catch(() => {});
  await control(db, sync.a.id, "pause", sync.s.pause);
  await refreshDemo(db, workspace, now, true);
}

/**
 * Creates the demo account the first time its address signs in, or gives it the password whose hash TEND_DEMO_ACCOUNT holds now (which ends
 * its sessions). An account with that address that is not read-only is somebody's own and is left alone.
 */
export async function ensureDemoAccount(db: DB, now = Date.now()) {
  const d = config.demoAccount;
  if (!d) return;
  const u = await db.get<{ id: string; read_only: number; password_hash: string }>("SELECT id, read_only, password_hash FROM users WHERE email = ?", d.email);
  if (u) {
    if (u.read_only && u.password_hash !== d.hash) await db.run("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?", d.hash, now, u.id);
    return;
  }
  const id = `u_${randomUUID().replaceAll("-", "").slice(0, 20)}`, workspace = `ws_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const created = await db.tx(async (q) => {
    await q.run("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)", workspace, "YC Demo", now);
    // password_changed_at 0: a new account has no older sessions to end, and a sign-in that began a moment before this one (and so carries an
    // earlier time) must not get a session that is void on arrival.
    await q.run("INSERT INTO users (id, email, password_hash, workspace_id, created_at, email_verified_at, approved_at, approved_by, password_changed_at, read_only) VALUES (?, ?, ?, ?, ?, ?, ?, 'demo', 0, 1)",
      id, d.email, d.hash, workspace, now, now, now);
    await q.run("INSERT INTO onboarding (user_id, step, started_at, updated_at, skipped_at) VALUES (?, 'done', ?, ?, ?)", id, now, now, now);
    await audit(q, "account.registered", { userId: id, reason: "read-only demo account", now });
    return true;
  }).catch((e) => {
    // Two first sign-ins at the same moment: the other one created it.
    if (String((e as Error).message).includes("users_email_key")) return false;
    throw e;
  });
  if (created) await seed(db, workspace, now).catch((e) => console.error("[tend] could not add the demo's sample data:", (e as Error).message));
}

/**
 * Keeps the demo workspace looking like a live one: at most every few minutes, a couple of new allowed or refused calls, one request waiting
 * for a person when fewer than two are, and a heartbeat from the agents that are running. Only sample agents of this workspace are touched.
 * ponytail: the demo's history is never pruned; at worst ~5 requests per 3 minutes while someone is looking. Prune old sample rows if it grows.
 */
export async function refreshDemo(db: DB, workspace: string, now = Date.now(), force = false) {
  const key = `demoacct.tick.${workspace}`;
  // One reader wins the top-up for this window, however many poll at once.
  const won = force
    ? await db.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", key, String(now))
    : await db.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value WHERE CAST(meta.value AS BIGINT) <= ?", key, String(now), now - EVERY);
  if (!won) return;
  const live = (await allAgents(db, workspace)).filter((a) => a.origin === "connected" && a.status !== "paused" && a.integrationEnabled);
  const sample = (a: Agent) => SAMPLES.find((s) => s.name === a.name);
  if (!live.length) return;
  for (const i of [2, 1]) {
    const a = pick(live), s = sample(a);
    if (s) await act(db, a, Math.random() < 0.8 ? pick(s.allow) : pick(s.deny), now - i * 20 * S, "nothing");
  }
  const ids = live.map((a) => a.id);
  const { n } = (await db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM authorizations WHERE status = 'pending' AND expires_at > ? AND agent_id IN (${ids.map(() => "?").join(", ")})`, now, ...ids))!;
  if (n < 2) {
    const a = pick(live), s = sample(a);
    if (s) await act(db, a, pick(s.approve), now - 5 * S, "nothing");
  }
  for (const a of live) await ingestEvents(db, a, [{ type: "agent.heartbeat" }], now);
}
