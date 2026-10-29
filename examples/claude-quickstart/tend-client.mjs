// The one line a developer adds to an agent:  const gate = connectTend();
// Then wrap every sensitive tool:               await gate.run({ tool, action, resource, detail }, () => doTheRealThing());
// The tool function runs only if TEND allowed exactly that request (by policy, or because a person approved it); otherwise `gate.run`
// returns { executed: false, outcome, detail } and nothing happened. Settings come from the environment (TEND_URL, TEND_AGENT_KEY);
// a missing or rejected setting, or a TEND that is not running, produces a sentence saying what to do, never a stack trace.
import { createGate } from "../claude-agent/gate.mjs";

export function connectTend({ url = process.env.TEND_URL ?? "http://localhost:3000", key = process.env.TEND_AGENT_KEY, onPending, log, ...options } = {}) {
  if (!key) {
    throw new Error(`TEND_AGENT_KEY is not set, so this agent has no identity at TEND.
Register the agent once (this also writes its key to .env.agent):
  npm run tester:agent -- "My agent" --rule my_tool:run:approve
then start your agent with:  node --env-file=.env.agent your-agent.mjs`);
  }
  const tend = async (path, body, headers = {}) => {
    let res;
    try {
      res = await fetch(url + path, {
        method: body ? "POST" : "GET",
        headers: { authorization: `Bearer ${key}`, ...(body && { "content-type": "application/json" }), ...headers },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw Object.assign(new Error(`TEND is not reachable at ${url}`), { code: "unreachable", hint: `TEND is not reachable at ${url}. Start it ("npm run dev", or "npm run demo" for a throwaway one) or set TEND_URL to the right address.` });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint = res.status === 401 ? `TEND at ${url} does not accept this agent key (${data.error ?? "unauthorized"}). It may have been revoked, or issued by a different TEND. Run "npm run tester:agent" again and restart the agent.` : undefined;
      throw Object.assign(new Error(`TEND ${res.status} ${data.error}: ${data.message}`), { status: res.status, code: data.error, body: data, ...(hint && { hint }) });
    }
    return data;
  };
  // Every outcome is reported to TEND's audit log as a tool.called event (what ran, or why not), exactly as authorized. A failed report never
  // changes the outcome: the authorization record already shows what TEND decided.
  const report = (data) => tend("/api/v1/events", { type: "tool.called", data });
  const gate = createGate({ tend, onPending, log, ...options });
  return { ...gate, run: (request, execute, rep = report) => gate.run(request, execute, rep) };
}
