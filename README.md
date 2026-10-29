# TEND: a checkpoint between your AI agent and what it is able to do

An AI agent that can send emails, change records or spend money is only as safe as the last thing it decided to do. TEND sits in front of those actions. Before a tool
runs, your agent asks TEND. TEND answers in one of three ways: **allow** (your rule says this is fine), **ask me** (a person sees the exact action and decides, and the
approval works once, for that action only), or **never**. Everything is written to a log. You run it on your own computer; nothing is hosted, and your API keys never reach TEND.

## Your first controlled action in 5 minutes

You need Node 20.12 or newer (Node 22 or 24 is best), git and a terminal. No account, no API key, no file to edit.

```bash
git clone <the repository address you were sent> tend
cd tend
npm ci
npm run demo
```

`npm run demo` starts a throwaway TEND (it exists only while the command runs), puts a Claude agent in front of it with three harmless tools, and shows you:
one action **allowed** by your rule, one **denied** by your rule, and two that **wait for you**. You answer `y` or `n` right in the terminal; try `n` on the second one.
It ends by printing what TEND recorded. The first time it also builds TEND (about 15 seconds). Its sign-in token stays in memory and is never printed.

**With a real Claude model** (a cent or two of API usage): paste your key without it appearing anywhere, then run the demo again.

```bash
read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY    # paste the key, press Enter; nothing is shown
npm run demo
```

Without a key a scripted stand-in plays Claude and the demo says so; TEND itself is real either way. The key stays in your shell. TEND never sees it, and the demo never prints it.

## Put TEND in front of your own agent

Copy `examples/claude-quickstart/tend-client.mjs` and `examples/claude-agent/gate.mjs` next to your agent (change the one import in `tend-client.mjs` to `./gate.mjs`). Then wrap the function that does the real thing:

```js
import { connectTend } from "./tend-client.mjs";
const gate = connectTend();                    // reads TEND_URL and TEND_AGENT_KEY from the environment

const out = await gate.run(
  { tool: "send_email", action: "send", resource: "client-1042", detail: "Email to client 1042, subject: Invoice 42" }, // exactly what will be done
  () => sendEmail(/* your real code */),         // runs only if TEND said yes, and then exactly once
);
if (!out.executed) return `Not done: ${out.outcome}. ${out.detail ?? ""}`;   // tell the model, so it can tell the user
```

- `tool` and `action` are names you choose. `resource` is an identifier of what is touched (1 to 64 letters, digits or `_ . : -`; no `@` or spaces). `detail` is the sentence the person will read before deciding (up to 200 characters). What you pass is exactly what is approved.
- A tool with no rule is refused. You write the rules once: `npm run tester:agent -- "My agent" --rule send_email:send:approve --rule read_ticket:read:allow --rule delete_record:delete:deny` (`approve` = a person decides, `allow` = automatic, `deny` = never). This also registers the agent and saves its key to `.env.agent` (never printed).
- A complete, working Claude agent (about 80 lines, much of it comments and error messages), with the loop that hands Claude each result: `examples/claude-quickstart/agent.mjs`. Run it against your own TEND with
  `node --env-file=.env.agent examples/claude-quickstart/agent.mjs "Send a demo email to team-1 saying hello"` (after `npm run tester:agent -- "Claude demo" --rule read_demo_note:read:allow --rule send_demo_email:send:approve --rule delete_demo_record:delete:deny`).

## One policy for several agents (Claude and OpenAI)

`npm run demo:cross` shows two independent agents, a Claude one and an OpenAI one, each with its own key, under one central policy. Changing the policy once changes both, without touching or restarting either agent. Both appear in one audit history, and revoking one leaves the other working.
A provider whose key is set (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) runs a real model; the other is played by a scripted stand-in, and the demo says which is which.

How central policies work (operator API, signed-in operators only):

- `POST /api/v1/central-policies` with `{ "name": "...", "rules": [...] }` creates one; `POST /api/v1/central-policies/{id}` with `{ "rules": [...] }` changes it; `POST /api/v1/central-policies/{id}/assignments` with `{ "assign": [agent ids], "unassign": [...] }` assigns it. `GET /api/v1/central-policies` lists them with their agents.
- **Precedence:** for any tool the central policy has a rule for, the stricter of the central rule and the agent's own rule wins, so an agent's own rules can tighten but never loosen it. Tools the central policy doesn't mention follow the agent's own rules, as before. An unreadable central policy refuses everything.
- A change applies to every assigned agent at once, including requests already waiting or approved: anything the new rules forbid can no longer be used. Each assignment and change is recorded for every agent it affects, with the full rules.
- An agent can follow one central policy at a time. Central policies cannot be deleted (unassign them instead). The protection checks on the Verification page say "not verified" for agents under a central policy.

## Run your own TEND with a dashboard

For when you want to click instead of typing `y`:

```bash
npm run tester:init -- yourname     # writes .env.local with your own random sign-in token (mode 600; not printed)
npm run dev                         # leave this running
```

Open <http://localhost:3000/operator> and paste the value after `TEND_ADMIN_TOKEN=` from `.env.local`. Requests that need you appear under **Approvals** (<http://localhost:3000/oversight>) with the exact action.
Your own tools show a warning (TEND has no built-in knowledge of them) and need one click, **Allow once**. Spending always asks twice.

## If something goes wrong

| You see | It means | Do this |
|---|---|---|
| `TEND needs Node 20.12 or newer` | your Node is too old | install Node 22 or 24 (nodejs.org, or `nvm install 24`) |
| `TEND is not reachable at ...` | nothing is listening there | `npm run dev` (or `npm run demo` for a throwaway one); another port: set `TEND_URL` |
| `TEND does not accept this agent key` | revoked, or issued by a different TEND | run `npm run tester:agent` again, restart your agent |
| `TEND_AGENT_KEY is not set` | the agent has no identity yet | run `npm run tester:agent`, then `node --env-file=.env.agent your-agent.mjs` |
| `ANTHROPIC_API_KEY is not set` / `Anthropic rejected the API key (401)` | no key, or a wrong one | the `read -rs` command above |
| `resource must be 1-64 characters ...` | `resource` has a character TEND does not accept | use letters, digits and `_ . : -` only |
| anything else odd | | `npm run agents:doctor` checks file permissions, saved keys and the address |

The demo and the integration work on Node 20.12 or newer. The project's own test suite (`npm test`) runs TypeScript directly and needs Node 22.18 or newer (24 is what it is tested on). On Node 20 you may also see a few "Unsupported engine" warnings from dependencies during `npm ci`; they are harmless.

## What to tell us

Time from `git clone` to your first controlled action. Anything that failed or confused you, with the exact message. And three questions: what would you have used instead? Would you miss it if it went away? Who else building agents needs this? Short answers are fine.

## Honest limits

- **TEND stops only code that asks it.** An agent that skips the wrapper, or holds the real credentials itself, can bypass it. Use fake or low-risk actions in this test.
- Use fictional data. TEND records tool names, resources, the exact text you approve and your decisions, on your machine only (`.data/`).
- One sign-in token, no accounts or teams, no notifications; the dashboard must be open to approve. This is a prototype for controlled testing, not for production, and it has had no independent security review.
- More detail: `docs/gateway.md`, `docs/enforcement.md`, `docs/audit.md`, and the test report `docs/real-claude-test.md`.
