// Phase 3: property/fuzz tests against the real policy engine (pure functions, in-process). Run: node --no-warnings redteam/live/fuzz-policy.mjs
import { evaluate, parseAuthRequest, parsePolicy, fingerprint, decidingRule } from "../../src/server/policy.ts";
let seed = Number(process.env.SEED ?? 1337);
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const strength = { allow: 1, approve: 2, deny: 3 };
const agent = { status: "active", integrationEnabled: true, permissions: [] };
const keys = ["amount", "to", "path", "command", "n"];
const scalars = () => pick([0, 1, 49, 50, 51, 5000, "5000", "abc", "a@example.com", "x@evil.com", "/data/x", "/etc/x", "rm -rf /", true, null, "", "A".repeat(300)]);
const conds = () => pick([{ gt: 50 }, { lte: 50 }, { lt: 100 }, { gte: 10 }, { equals: "5000" }, { in: [1, 5000] }, { contains: "rm" }, { startsWith: "/data" }, { endsWith: "example.com" }, { emailDomainIn: ["example.com"] }, { pathUnder: ["/data"] }, { notIn: ["x"] }, { exists: true }, { exists: false }]);
const mkRule = () => ({ tool: "t", action: pick(["a", "*"]), effect: pick(["allow", "approve", "deny"]), ...(rnd() < 0.7 && { when: Object.fromEntries(Array.from({ length: 1 + Math.floor(rnd() * 2) }, () => [pick(keys), conds()])) }) });
const mkPolicy = () => Array.from({ length: 1 + Math.floor(rnd() * 5) }, mkRule);
const mkArgs = () => Object.fromEntries(keys.filter(() => rnd() < 0.7).map((k) => [k, rnd() < 0.15 ? [scalars(), scalars()] : scalars()]));
const eff = (rules, args) => evaluate(agent, rules, { tool: "t", action: "a", resource: null, detail: null, args });
const N = Number(process.env.N ?? 20000);
const viol = { summary: [], typeNum: [], crash: [], fp: [], monoRule: [] };
const seen = new Map();
for (let i = 0; i < N; i++) {
  const rules = mkPolicy(), args = mkArgs();
  let base;
  try { base = eff(rules, args); } catch (e) { viol.crash.push({ rules, args, e: String(e) }); continue; }
  // P1: replacing any argument by a long-value summary must never loosen the decision
  for (const k of Object.keys(args)) {
    const a2 = { ...args, [k]: { sha256: "ab".repeat(32), length: 999 } };
    if (strength[eff(rules, a2).effect] < strength[base.effect]) viol.summary.push({ rules, args, k });
  }
  // P4: numeric value expressed as a numeric string (same meaning to a lenient tool) must not loosen
  const textOps = ["startsWith", "endsWith", "contains", "pathUnder", "emailDomainIn"];
  // only keys whose conditions are numeric/equality: for text operators a string IS the right type
  for (const k of Object.keys(args)) if (typeof args[k] === "number" && !rules.some((r) => r.when?.[k] && Object.keys(r.when[k]).some((o) => textOps.includes(o)))) {
    const a2 = { ...args, [k]: String(args[k]) };
    if (strength[eff(rules, a2).effect] < strength[base.effect]) viol.typeNum.push({ rules, args, k, base: base.effect, got: eff(rules, a2).effect });
  }
  // P5: fingerprint injectivity on random requests
  const r = { tool: "t", action: "a", resource: rnd() < 0.5 ? "r" + Math.floor(rnd() * 3) : null, detail: rnd() < 0.5 ? "d" + Math.floor(rnd() * 3) : null, args };
  const fp = fingerprint("agent1", r), canon = JSON.stringify([r.resource, r.detail, args && Object.keys(args).sort().map((k) => [k, args[k]])]);
  if (seen.has(fp) && seen.get(fp) !== canon) viol.fp.push({ a: seen.get(fp), b: canon }); seen.set(fp, canon);
  // P6: adding a deny rule without `when` for the same tool/action can only tighten
  const withDeny = [...rules, { tool: "t", action: "a", effect: "deny" }];
  if (strength[eff(withDeny, args).effect] < strength[base.effect]) viol.monoRule.push({ rules, args });
}
// P3: junk policies/requests never throw and never allow
const junk = [null, undefined, 5, "x", [], {}, [null], [{}], [{ tool: "t", action: "a", effect: "allow", when: 5 }], [{ tool: "t", action: "a", effect: "allow", extra: 1 }], "{", JSON.stringify([{ tool: "t", action: "a", effect: "allow" }]).slice(0, -3)];
for (const j of junk) { try { const d = eff(j, {}); if (d.effect === "allow") viol.crash.push({ junk: j, d }); } catch (e) { viol.crash.push({ junk: j, e: String(e) }); } }
for (const j of [null, 1, "s", [], { tool: 1 }, { tool: "t", action: "a", args: [] }, { tool: "t", action: "a", args: { a: { b: { c: { d: { e: { f: 1 } } } } } } }, { tool: "t", action: "a", __proto__: { x: 1 } }, JSON.parse('{"tool":"t","action":"a","args":{"__proto__":{"x":1}}}')]) { try { parseAuthRequest(j); } catch (e) { viol.crash.push({ req: j, e: String(e) }); } }
console.log(`iterations=${N} seed=${process.env.SEED ?? 1337}`);
for (const [k, v] of Object.entries(viol)) console.log(`${k.padEnd(8)} violations=${v.length}`, v.length ? JSON.stringify(v[0]).slice(0, 420) : "");
