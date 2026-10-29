// A minimal Claude agent whose every tool call goes through TEND first. This is the whole integration:
//   1. give Claude your tools (TOOLS),
//   2. when Claude asks for one, call gate.run({ tool, action, resource, detail }, () => theRealThing()),
//   3. hand Claude the result, or "NOT EXECUTED (...)" if TEND said no, so it can tell the user.
// Run against your own TEND (after: npm run tester:agent -- "Claude demo" --rule read_demo_note:read:allow --rule send_demo_email:send:approve --rule delete_demo_record:delete:deny):
//   ANTHROPIC_API_KEY=... node --env-file=.env.agent examples/claude-quickstart/agent.mjs "Send a demo email to team-1 saying hello"
import { connectTend } from "./tend-client.mjs";
import { SYSTEM, TOOLS, createWorld, plan } from "./tools.mjs";

/**
 * @param client  an Anthropic SDK client (or anything with messages.create)
 * @param gate    from connectTend()
 * @param world   the tools' data (createWorld())
 * @param onUsage optional ({ input_tokens, output_tokens }) per API call
 * @returns what Claude tried, what TEND decided for each, and Claude's final words
 */
export async function runClaude({ client, gate, world, prompt, model = "claude-haiku-4-5", maxTurns = 6, onUsage = () => {}, shouldStop = () => false }) {
  const messages = [{ role: "user", content: prompt }];
  const out = { attempts: [], outcomes: [], final: "", stops: [], errors: [] };
  for (let turn = 0; turn < maxTurns; turn++) {
    if (shouldStop()) { out.errors.push("stopped: spending cap reached"); break; }
    let res;
    try {
      res = await client.messages.create({ model, max_tokens: 512, system: SYSTEM, tools: TOOLS, messages });
    } catch (e) {
      out.errors.push(apiProblem(e));
      break;
    }
    onUsage(res.usage);
    out.stops.push(res.stop_reason);
    messages.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((b) => b.type === "tool_use");
    if (!uses.length) { out.final = res.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim(); break; }
    const results = [];
    for (const u of uses) {
      out.attempts.push({ tool: u.name, input: u.input });
      const p = plan(world, u.name, u.input);
      if (!p) { results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: "unknown tool" }); continue; }
      const r = await gate.run(p.req, async () => p.run());
      out.outcomes.push({ tool: u.name, executed: r.executed, outcome: r.outcome, reason: r.reason, detail: r.detail, authorizationId: r.authorizationId });
      results.push({ type: "tool_result", tool_use_id: u.id, is_error: !r.executed, content: r.executed ? String(r.result) : `NOT EXECUTED (${r.outcome}${r.reason ? `: ${r.reason}` : ""})` });
    }
    messages.push({ role: "user", content: results });
  }
  return out;
}

/** A sentence for an Anthropic API failure that says what to do. Never includes the key. */
export function apiProblem(e) {
  const s = e?.status;
  if (s === 401) return "Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY: it must be a current key from console.anthropic.com, set in your shell, not in a file that is committed.";
  if (s === 403) return "Anthropic refused the request (403). The key may not have access to this model.";
  if (s === 404) return "Anthropic does not know this model (404). Set CLAUDE_MODEL to a current model id, for example claude-haiku-4-5.";
  if (s === 429) return "Anthropic is rate limiting this key (429). Wait a minute and run it again.";
  if (s >= 500) return `Anthropic had a server problem (${s}). Run it again in a moment.`;
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(`${e?.message} ${e?.cause?.code ?? ""}`)) return "Could not reach api.anthropic.com. Check the internet connection (and any proxy or firewall).";
  return `Anthropic API error${s ? ` (${s})` : ""}: ${String(e?.message ?? e).slice(0, 160)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await import("../../scripts/node-check.mjs");
  const prompt = process.argv.slice(2).join(" ") || "Read demo note N-1, then send a demo email to team-1 saying what it says.";
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. Set it for this one command without putting it in a file or in chat:\n  read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY    (paste the key, press Enter; nothing is shown)\nThen run this again.');
    process.exit(2);
  }
  let gate;
  try {
    gate = connectTend({ log: (l) => console.log(l), onPending: () => console.log("  Waiting for you: decide in the TEND dashboard (Approvals), or run  npm run tend -- pending") });
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const r = await runClaude({ client: new Anthropic({ maxRetries: 1 }), gate, world: createWorld(), prompt, model: process.env.CLAUDE_MODEL ?? "claude-haiku-4-5" });
  for (const o of r.outcomes) console.log(`${o.tool}: ${o.executed ? "ran" : `NOT run (${o.outcome}${o.reason ? `: ${o.reason}` : ""})`}${o.detail ? ` - ${o.detail}` : ""}`);
  if (r.final) console.log(`Claude: ${r.final}`);
  for (const e of r.errors) console.error(e);
  process.exit(r.errors.length ? 1 : 0);
}
