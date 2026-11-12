// Independent red-team harness for TEND's enforcement core. Drives the REAL server modules against a
// fresh in-memory DB — no reliance on TEND's own test files. Prints HELD / BROKEN per brief item.
// Run: node --no-warnings redteam/attacks.ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Gateway credentials must exist (>=24 chars) or the spend tool is "unavailable" (fail closed).
process.env.TEND_GATEWAY_PAYMENTS_KEY = "x".repeat(32);
const SANDBOX = mkdtempSync(path.join(tmpdir(), "tend-rt-sbx-"));
process.env.TEND_GATEWAY_SANDBOX_DIR = SANDBOX;

const { memoryDb } = await import("../src/server/db.ts");
const { HttpError } = await import("../src/server/http.ts");
const { requestAuthorization, claimToken, consumeAuthorization, spendApproved, TTL, MISMATCH_LIMIT } = await import("../src/server/authz.ts");
const { registerAgent, setPolicy, decide, revokeKey, control } = await import("../src/server/repo.ts");
const { requestExecution, executeTool, fakePayments } = await import("../src/server/gateway.ts");
const { verifyAudit } = await import("../src/server/audit-chain.ts");
const { allowEventRemoval } = await import("../src/server/db.ts");
const { createCentralPolicy, updateCentralPolicy, assignCentralPolicy } = await import("../src/server/repo.ts");

let held = 0, broken = 0, gaps = 0;
const mark = (ok: boolean, label: string, note = "") => {
  console.log(`${ok ? "HELD  " : "BROKEN"}  ${label}${note ? "  — " + note : ""}`);
  ok ? held++ : broken++;
};
// For integrity GAPS: confirmed === true means the weakness is present.
const gap = (confirmed: boolean, label: string, note = "") => {
  console.log(`${confirmed ? "GAP   " : "ok    "}  ${label}${note ? "  — " + note : ""}`);
  if (confirmed) gaps++;
};
const err = async (fn: () => Promise<unknown>) => {
  try { await fn(); } catch (e) { if (e instanceof HttpError) return { status: e.status, code: e.code, extra: e.extra as any }; throw e; }
  return null; // no throw
};

const PAY_POLICY = [{ tool: "pay_invoice", action: "execute", effect: "approve" }];
const payBody = (over: object = {}) => ({ tool: "pay_invoice", params: { invoice: "INV-1", amountCents: 500, currency: "EUR", payee: "PAYEE-1", ...over } });

async function freshAgent(db: any, policy: unknown, name = "Probe") {
  const { agent } = await registerAgent(db, { name, model: "m", provider: "Anthropic" });
  await setPolicy(db, agent.id, policy as any, "enforce");
  return agent;
}
// Drive a gateway tool from request → approve → token → execute. Returns {id, token}.
async function approvedExec(db: any, agent: any, body: object, now = Date.now()) {
  const { view } = await requestExecution(db, agent, body, null, now);
  if (view.status === "pending") await decide(db, view.id, "approved", undefined, "op");
  const token = ((await claimToken(db, agent, view.id, now)).view as any).token;
  return { id: view.id, token };
}

console.log("\n==== A. APPROVAL BINDING ====");
{
  const db = await memoryDb();
  const agent = await freshAgent(db, PAY_POLICY);
  // A1: replay — consume the same approval twice.
  {
    const { id, token } = await approvedExec(db, agent, payBody());
    const ok1 = await executeTool(db, agent, { authorizationId: id, token, ...payBody() });
    const e2 = await err(() => executeTool(db, agent, { authorizationId: id, token, ...payBody() }));
    const alerts = await db.all("SELECT data FROM events WHERE type='alert.raised'");
    const replay = alerts.some((a: any) => JSON.parse(a.data).kind === "authorization_replay");
    mark(!!ok1?.executed && e2?.status === 409 && e2.code === "already_consumed" && replay, "A1 replay a consumed approval", `2nd=${e2?.code}, replay_alert=${replay}`);
  }
  // A2: change the amount, reuse the old token.
  {
    const { id, token } = await approvedExec(db, agent, payBody());
    const e = await err(() => executeTool(db, agent, { authorizationId: id, token, ...payBody({ amountCents: 9999 }) }));
    const r: any = await db.get("SELECT mismatches,status FROM authorizations WHERE id=?", id);
    mark(e?.status === 403 && e.code === "mismatch" && r.mismatches === 1, "A2 tamper amount, reuse old approval", `code=${e?.code}, mismatches=${r.mismatches}`);
  }
  // A2b: change recipient (payee).
  {
    const { id, token } = await approvedExec(db, agent, payBody());
    const e = await err(() => executeTool(db, agent, { authorizationId: id, token, ...payBody({ payee: "PAYEE-2" }) }));
    mark(e?.code === "mismatch", "A2b tamper payee, reuse old approval", `code=${e?.code}`);
  }
  // A3: use an approval after expiry (advance 'now' beyond token + approval TTL).
  {
    const now = Date.now();
    const { view } = await requestExecution(db, agent, payBody(), null, now);
    await decide(db, view.id, "approved", undefined, "op");
    const token = ((await claimToken(db, agent, view.id, now)).view as any).token;
    const later = now + TTL.approval + TTL.token + 1000;
    const e = await err(() => executeTool(db, agent, { authorizationId: view.id, token, ...payBody() }, later));
    mark(e?.status === 403, "A3 consume after approval/token expiry", `code=${e?.code}`);
  }
  // A4: agent B's approval used by agent A.
  {
    const agentB = await freshAgent(db, PAY_POLICY, "Other");
    const { id, token } = await approvedExec(db, agentB, payBody());
    const e = await err(() => executeTool(db, agent, { authorizationId: id, token, ...payBody() }));
    mark(e?.status === 404, "A4 cross-agent: A spends B's approval", `code=${e?.code}`);
  }
  // A5: race two concurrent consumes of the SAME approval — exactly one wins.
  {
    const { id, token } = await approvedExec(db, agent, payBody());
    const results = await Promise.allSettled([
      executeTool(db, agent, { authorizationId: id, token, ...payBody() }),
      executeTool(db, agent, { authorizationId: id, token, ...payBody() }),
    ]);
    const wins = results.filter((r) => r.status === "fulfilled").length;
    mark(wins === 1, "A5 concurrent double-consume of one approval", `winners=${wins}`);
  }
  // A5b: two identical requests (no idempotency key) — each needs its own approval; one approval can't cover both.
  {
    const now = Date.now();
    const a = await requestExecution(db, agent, payBody(), null, now);
    const b = await requestExecution(db, agent, payBody(), null, now);
    const distinct = a.view.id !== b.view.id && a.view.status === "pending" && b.view.status === "pending";
    await decide(db, a.view.id, "approved", undefined, "op"); // approve only ONE
    const tokenA = ((await claimToken(db, agent, a.view.id, now)).view as any).token;
    const okA = await executeTool(db, agent, { authorizationId: a.view.id, token: tokenA, ...payBody() }, now);
    // the other is still pending → no token, cannot execute
    const eB = await err(() => claimToken(db, agent, b.view.id, now).then((v: any) => v.view.token ? executeTool(db, agent, { authorizationId: b.view.id, token: v.view.token, ...payBody() }, now) : Promise.reject(new HttpError(403, "no_token", "pending"))));
    mark(distinct && !!okA?.executed && !!eB, "A5b one approval cannot cover two identical requests", `distinctIds=${distinct}, secondBlocked=${!!eB}`);
  }
  // A6: spendApproved (one-round-trip flow) replay + mismatch.
  {
    const now = Date.now();
    const { view } = await requestAuthorization(db, agent, { tool: "x_tool", action: "run", detail: "do a thing" }, null, now);
    // x_tool isn't in policy → denied. Use a policy-approved cooperative tool instead:
    await setPolicy(db, agent.id, [{ tool: "coop_pay", action: "execute", effect: "approve" }], "enforce");
    const r = await requestAuthorization(db, agent, { tool: "coop_pay", action: "execute", resource: "INV-9", detail: "EUR 1" }, null, now);
    await decide(db, r.view.id, "approved", undefined, "op");
    const ok = await spendApproved(db, agent, r.view.id, { tool: "coop_pay", action: "execute", resource: "INV-9", detail: "EUR 1" }, now);
    const replay = await err(() => spendApproved(db, agent, r.view.id, { tool: "coop_pay", action: "execute", resource: "INV-9", detail: "EUR 1" }, now));
    mark((ok as any).authorized && replay?.status === 409, "A6 spendApproved replay blocked", `replay=${replay?.code}`);
  }
}

console.log("\n==== B. RULES & GATEWAY ====");
{
  const db = await memoryDb();
  // B1: 'Never' tool — saving an `allow` rule for pay_invoice is refused.
  {
    const agent = await freshAgent(db, []);
    const e = await err(() => setPolicy(db, agent.id, [{ tool: "pay_invoice", action: "execute", effect: "allow" }], "enforce"));
    mark(e?.status === 422, "B1 policy save: allow on pay_invoice refused", `code=${e?.code}`);
  }
  // B1b: force an `allow` row straight into the DB (bypassing save) — still evaluated as approve (needs a person).
  {
    const agent = await freshAgent(db, []);
    await db.run("UPDATE agents SET policy = ? WHERE id = ?", JSON.stringify([{ tool: "pay_invoice", action: "execute", effect: "allow" }]), agent.id);
    const { view } = await requestExecution(db, agent, payBody(), null);
    mark(view.status === "pending", "B1b DB-planted allow on pay_invoice → still pending (approve)", `status=${view.status}`);
  }
  // B1c (fix #3): a `when` amount-limit on a gateway spend tool is refused at save (it could never apply).
  {
    const agent = await freshAgent(db, []);
    const e = await err(() => setPolicy(db, agent.id, [{ tool: "pay_invoice", action: "execute", effect: "approve", when: { amountCents: { lte: 500 } } }], "enforce"));
    mark(e?.status === 422 && e.code === "spend_requires_approval", "B1c when-limit on gateway spend tool refused at save", `code=${e?.code}`);
  }
  // B2: tool-name tricks on the gateway allowlist.
  {
    const agent = await freshAgent(db, [{ tool: "pay_invoice", action: "execute", effect: "approve" }]);
    const tricks: [string, string][] = [
      ["PAY_INVOICE", "uppercase"], ["pay_invoice ", "trailing space"], ["pay_invoice​", "zero-width"],
      ["pay_invoіce", "cyrillic lookalike"], ["*", "wildcard"], ["../pay_invoice", "path traversal"], ["pay_invoice;DROP", "sql-ish"],
    ];
    let allRejected = true, detail = "";
    for (const [name, why] of tricks) {
      const e = await err(() => requestExecution(db, agent, { tool: name, params: payBody().params }, null));
      if (!(e && (e.status === 404 || e.status === 422))) { allRejected = false; detail += `${why}=${e?.status ?? "PASSED!"} `; }
    }
    mark(allRejected, "B2 gateway tool-name tricks (case/unicode/wildcard/traversal) all rejected", detail || "all 404/422");
  }
  // B3: credential never reaches the agent, even though the fake upstream echoes it in a debug field.
  {
    const agent = await freshAgent(db, [{ tool: "pay_invoice", action: "execute", effect: "approve" }]);
    const { id, token } = await approvedExec(db, agent, payBody());
    const out: any = await executeTool(db, agent, { authorizationId: id, token, ...payBody() });
    const blob = JSON.stringify(out);
    const leaked = blob.includes(process.env.TEND_GATEWAY_PAYMENTS_KEY!) || /Bearer /.test(blob) || "debug" in (out.result ?? {});
    // also confirm no event carries the key
    const evs = await db.all("SELECT data FROM events");
    const inEvents = evs.some((e: any) => e.data.includes(process.env.TEND_GATEWAY_PAYMENTS_KEY!));
    mark(!leaked && !inEvents, "B3 gateway credential never returned to agent or logged", `resultKeys=${Object.keys(out.result ?? {})}`);
  }
  // B4: param-smuggle at execute — different params than the approval binds.
  {
    const agent = await freshAgent(db, [{ tool: "pay_invoice", action: "execute", effect: "approve" }]);
    const { id, token } = await approvedExec(db, agent, payBody({ amountCents: 100 }));
    const e = await err(() => executeTool(db, agent, { authorizationId: id, token, ...payBody({ amountCents: 100000 }) }));
    const paid = [...fakePayments().values()].some((v: any) => v.record?.amountCents === 100000);
    mark(e?.code === "mismatch" && !paid, "B4 execute with smuggled params refused, nothing paid", `code=${e?.code}, paidBig=${paid}`);
  }
}

console.log("\n==== C. FAIL-CLOSED (policy/state) ====");
{
  const db = await memoryDb();
  // C1: unreadable / invalid policy denies everything.
  {
    const agent = await freshAgent(db, []);
    await db.run("UPDATE agents SET policy = ? WHERE id = ?", "{not json", agent.id);
    const { view } = await requestAuthorization(db, agent, { tool: "read_document", action: "read", resource: "DOC-1" }, null);
    mark(view.status === "denied" && view.reason === "invalid_policy", "C1 invalid policy → deny all", `status=${view.status}/${view.reason}`);
  }
  // C2: paused agent / disabled integration deny.
  {
    const agent = await freshAgent(db, [{ tool: "read_document", action: "read", effect: "allow" }]);
    await control(db, agent.id, "pause");
    const { view } = await requestAuthorization(db, agent, { tool: "read_document", action: "read", resource: "DOC-1" }, null);
    mark(view.status === "denied", "C2 paused agent → deny", `status=${view.status}/${view.reason}`);
  }
  // C3: DB failure mid-flow → the action does not run (no payment recorded).
  // Simulate an outage by making the transaction layer reject, as a dead Postgres would.
  {
    const agent = await freshAgent(db, [{ tool: "pay_invoice", action: "execute", effect: "approve" }]);
    const { id, token } = await approvedExec(db, agent, payBody());
    const before = [...fakePayments().values()].reduce((n, v: any) => n + v.calls, 0);
    const brokenDb: any = new Proxy(db, { get(t, p) { if (p === "tx") return () => Promise.reject(new Error("ECONNREFUSED: database is down")); return (t as any)[p]; } });
    let threw = false;
    try { await executeTool(brokenDb, agent, { authorizationId: id, token, ...payBody() }); } catch { threw = true; }
    const after = [...fakePayments().values()].reduce((n, v: any) => n + v.calls, 0);
    mark(threw && after === before, "C3 DB unavailable mid-consume → no execution (fail closed)", `threw=${threw}, newToolCalls=${after - before}`);
  }
}

console.log("\n==== D. LOG INTEGRITY ====");
{
  const db = await memoryDb();
  const agent = await freshAgent(db, [{ tool: "read_document", action: "read", effect: "allow" }]);
  await requestAuthorization(db, agent, { tool: "read_document", action: "read", resource: "DOC-1" }, null);
  await requestAuthorization(db, agent, { tool: "read_document", action: "read", resource: "DOC-2" }, null);
  // D1/D2/D3: ordinary UPDATE / DELETE / TRUNCATE on events is refused by the trigger (raw SQLSTATE 42501).
  const refused = async (fn: () => Promise<unknown>) => { try { await fn(); return ""; } catch (e: any) { return e?.code ?? "threw"; } };
  const d1 = await refused(() => db.run("UPDATE events SET data = '{\"x\":1}' WHERE seq = (SELECT MIN(seq) FROM events)"));
  const d2 = await refused(() => db.run("DELETE FROM events WHERE seq = (SELECT MIN(seq) FROM events)"));
  const d3 = await refused(() => db.exec("TRUNCATE events"));
  mark(d1 === "42501", "D1 UPDATE an event row refused (append-only trigger)", `sqlstate=${d1 || "WROTE!"}`);
  mark(d2 === "42501", "D2 DELETE an event row refused", `sqlstate=${d2 || "DELETED!"}`);
  mark(d3 === "42501", "D3 TRUNCATE events refused", `sqlstate=${d3 || "TRUNCATED!"}`);
  // chain is intact right now
  const v0 = await verifyAudit(db);
  mark(v0.ok, "D4 chain verifies on untampered log", `checked=${v0.checked}`);
  const head = (v0 as any).head as string;
  const cp0 = { firstSeq: (v0 as any).firstChained, firstHash: (v0 as any).firstHash, headSeq: (v0 as any).headSeq, head };
  // D5: a DB-OWNER rewrite that recomputes the whole chain correctly (v2 formula, seq bound in) stays self-consistent to a
  // bare walk, but no longer matches a kept checkpoint (head/firstHash differ).
  await db.tx(async (q: any) => {
    await allowEventRemoval(q);
    const rows = await q.all("SELECT seq,id,agent_id,type,at,actor,data,hash FROM events ORDER BY seq");
    const { createHash } = await import("node:crypto");
    let prev = "";
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const data = i === 0 ? '{"tampered":true}' : r.data;
      const h = createHash("sha256").update(`${prev}|${r.seq}|${r.id}|${r.agent_id}|${r.type}|${r.at}|${r.actor}|${data}`, "utf8").digest("hex");
      await q.run("UPDATE events SET data=?, hash=? WHERE seq=?", data, h, r.seq);
      prev = h;
    }
  });
  const v1: any = await verifyAudit(db);
  mark(v1.ok, "D5a full DB-owner rewrite is self-consistent to a bare walk (as documented)", `ok=${v1.ok}`);
  const v1cp: any = await verifyAudit(db, 2000, cp0);
  mark(!v1cp.ok, "D5b FIX: a kept checkpoint catches the full rewrite", `reason=${v1cp.reason}`);
  // Helper: a fresh db with several hashed events, plus its verify head and a checkpoint to keep.
  const seeded = async () => {
    const d = await memoryDb();
    const a = await freshAgent(d, [{ tool: "read_document", action: "read", effect: "allow" }]);
    for (let i = 1; i <= 4; i++) await requestAuthorization(d, a, { tool: "read_document", action: "read", resource: `DOC-${i}` }, null);
    const v: any = await verifyAudit(d);
    return { d, head: v.head as string, checkpoint: { firstSeq: v.firstChained, firstHash: v.firstHash, headSeq: v.headSeq, head: v.head } };
  };
  // D6: tamper a NON-FIRST event's data without fixing hash → audit-verify MUST catch it (chain works for the body).
  {
    const { d } = await seeded();
    await d.tx(async (q: any) => { await allowEventRemoval(q); await q.run("UPDATE events SET data='{\"evil\":1}' WHERE seq=(SELECT MAX(seq) FROM events)"); });
    const v = await verifyAudit(d);
    mark(!v.ok, "D6 tamper a mid/last event (hash not recomputed) → audit-verify detects break", `ok=${v.ok}, reason=${(v as any).reason ?? ""}`);
  }
  // D7 (was a GAP — now FIXED): tamper the FIRST chained event's data. Without a checkpoint it is still the unchecked
  // anchor (documented), but a kept checkpoint now catches it via the anchor's content hash.
  {
    const { d, head, checkpoint } = await seeded();
    await d.tx(async (q: any) => { await allowEventRemoval(q); await q.run("UPDATE events SET data='{\"evil\":1}' WHERE seq=(SELECT MIN(seq) FROM events)"); });
    const bare: any = await verifyAudit(d);
    gap(bare.ok && bare.head === head, "D7a bare walk still can't see an altered oldest event (documented, needs a checkpoint)", `ok=${bare.ok}`);
    const withCp: any = await verifyAudit(d, 2000, checkpoint);
    mark(!withCp.ok && /oldest kept event was altered/.test(withCp.reason), "D7b FIX: with a kept checkpoint, the altered oldest event is detected", `reason=${withCp.reason}`);
  }
  // D8 (was a GAP — now FIXED): delete a PREFIX of the log. Without a checkpoint the next survivor becomes the anchor
  // and a bare walk passes; a kept checkpoint catches the moved anchor.
  {
    const { d, head, checkpoint } = await seeded();
    const before: any = await d.get("SELECT COUNT(*)::int AS n FROM events");
    await d.tx(async (q: any) => { await allowEventRemoval(q); await q.run("DELETE FROM events WHERE seq IN (SELECT seq FROM events ORDER BY seq LIMIT 2)"); });
    const after: any = await d.get("SELECT COUNT(*)::int AS n FROM events");
    const bare: any = await verifyAudit(d);
    gap(bare.ok && bare.head === head && after.n < before.n, "D8a bare walk still can't see a prefix deletion (documented, needs a checkpoint)", `removed=${before.n - after.n}`);
    const withCp: any = await verifyAudit(d, 2000, checkpoint);
    mark(!withCp.ok && /oldest kept events were removed/.test(withCp.reason), "D8b FIX: with a kept checkpoint, the prefix deletion is detected", `reason=${withCp.reason}`);
  }
}

console.log("\n==== F. CENTRAL POLICY (tightens live; agents can't loosen) ====");
{
  const db = await memoryDb();
  // Agent's own policy says ALLOW read; central policy will override to stricter.
  const agent = await freshAgent(db, [{ tool: "read_document", action: "read", effect: "allow" }]);
  const cp: any = await createCentralPolicy(db, { name: "central-1", rules: [{ tool: "read_document", action: "read", effect: "approve" }] }, "op");
  await assignCentralPolicy(db, cp.id, { assign: [agent.id] }, "op");
  // F1: agent 'allow' cannot loosen central 'approve' → request needs a person (pending), not auto-allowed.
  {
    const now = Date.now();
    const { view } = await requestAuthorization(db, agent, { tool: "read_document", action: "read", resource: "DOC-1" }, null, now);
    mark(view.status === "pending", "F1 agent allow can't loosen central approve → pending", `status=${view.status}`);
    // approve + claim a token, then TIGHTEN central to deny, then try to consume → blocked live.
    await decide(db, view.id, "approved", undefined, "op");
    const token = ((await claimToken(db, agent, view.id, now)).view as any).token;
    await updateCentralPolicy(db, cp.id, { rules: [{ tool: "read_document", action: "read", effect: "deny" }] }, "op");
    const e = await err(() => consumeAuthorization(db, agent, view.id, { token, tool: "read_document", action: "read", resource: "DOC-1" }, now));
    mark(e?.status === 403 && e.code === "not_permitted", "F2 central tightened to deny after approval → already-issued token refused", `code=${e?.code}/${e?.extra?.reason}`);
  }
  // F3: an unreadable central policy denies everything (fail closed), even if the agent's own policy allows.
  {
    await db.run("UPDATE central_policies SET policy = ? WHERE id = ?", "{bad json", cp.id);
    const { view } = await requestAuthorization(db, agent, { tool: "read_document", action: "read", resource: "DOC-9" }, null);
    mark(view.status === "denied" && view.reason === "invalid_policy", "F3 unreadable central policy → deny all", `status=${view.status}/${view.reason}`);
  }
}

console.log(`\n==== RESULT: ${held} HELD, ${broken} BROKEN ====`);
console.log(`${gaps} integrity GAP(s) confirmed`);
process.exit(broken > 0 ? 1 : 0);
