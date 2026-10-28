# TEND tester guide: connect your own agent in under 15 minutes

TEND sits between an AI agent and a sensitive action. Your agent asks TEND first. TEND allows it, holds it for **you** to approve (the approval covers exactly that
action and works once), or refuses it, and keeps a record. You run everything **on your own computer**: nothing is hosted, nobody else can see your data, and
your provider keys never leave your machine. This page is all you need.

**What you need:** Node 24 (`node -v` says v24.x; Node 22 also worked in our test, with an "Unsupported engine" warning you can ignore), git, a terminal. For step 6 only: the AI provider key you already use (OpenAI or Anthropic), a few cents of usage.

## 1. Get it (about 3 minutes)

```bash
git clone <the repository address you were sent> tend
cd tend
npm ci
```

## 2. Your own settings (30 seconds)

```bash
npm run tester:init -- yourname
```

This creates `.env.local` (private to you, never shared or committed) with a random sign-in token. Nothing is printed: open `.env.local` and copy the value after `TEND_ADMIN_TOKEN=`.
Each tester has their own copy, their own token and their own data folder. Do not send your token to anyone, including us.

## 3. Check your setup without any key (about 4 minutes)

```bash
npm run build
npm run agents:try -- --auto
```

This starts a throwaway TEND, runs a scripted OpenAI-style and Claude-style agent against it, and ends with `All checks passed`. It proves your machine works before you touch your own agent.

## 4. Start your TEND (leave this terminal open)

```bash
npm run dev
```

Open <http://localhost:3000/operator> and paste the token. (Port 3000 busy? `PORT=3100 npm run dev`, and put `TEND_URL=http://localhost:3100` in front of the commands below.)

## 5. Register your agent and say what needs you (1 minute)

Think of one action your agent can do that you would not want it to do unattended (send an email, issue a refund, change a record, run a command). Give each tool a name:

```bash
npm run tester:agent -- "My agent" \
  --rule send_email:send:approve \
  --rule read_ticket:read:allow \
  --rule delete_record:delete:deny
```

`tool:action:effect`. **approve** = you decide each time, **allow** = automatic, **deny** = never. Anything without a rule is refused. The agent's key is saved in `.env.agent` (private; never printed).

## 6. Put one line around your tool (5 minutes)

Copy `examples/claude-agent/gate.mjs` into your project (it has no dependencies), then wrap the function that does the real thing:

```js
import { createGate } from "./gate.mjs";

const URL = process.env.TEND_URL ?? "http://localhost:3000";
const KEY = process.env.TEND_AGENT_KEY; // from .env.agent
const tend = async (p, body, headers = {}) => {
  const r = await fetch(URL + p, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${KEY}`, ...(body && { "content-type": "application/json" }), ...headers }, body: body && JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`TEND ${r.status} ${data.error}`), { status: r.status, code: data.error, body: data });
  return data;
};
const gate = createGate({ tend, onPending: () => console.log("Waiting for your approval at http://localhost:3000/operator → Approvals …") });

// in your tool:
const out = await gate.run(
  { tool: "send_email", action: "send", resource: "client-1042", detail: "Email to client 1042, subject: Invoice 42" }, // exactly what will be done
  () => sendEmail(/* your real code */),
);
if (!out.executed) return `Not done: ${out.outcome}`; // tell the model; it must not retry around it
```

`tool` and `action` are names you choose; `resource` is an identifier of what is touched (1 to 64 letters, digits, `_ . : -`, so no `@` or spaces); `detail` is the human-readable text you will read and approve. Whatever you pass is what the approval is bound to.

Run your agent with `node --env-file=.env.agent your-agent.mjs`. The request appears under **Approvals** (open <http://localhost:3000/oversight> after signing in). Your own tool names are not built into TEND, so it labels them "a kind of action Tend doesn't recognise" and asks you to confirm twice: **Allow once**, then **Yes, allow once**. That is expected. Your function then runs exactly once. Then try **Don't allow**, and pause or revoke the agent from the dashboard while it runs.

Using our OpenAI or Claude example agents instead? Put your provider key in `.env.agent` (`OPENAI_API_KEY=…` or `ANTHROPIC_API_KEY=…`), run `npm run agents:setup`, then `npm run agents:openai` or `npm run agents:anthropic`.

## What to tell us (this is the point of the test)

Time from step 1 to your first approved action. Anything that failed or confused you, with the exact message. And three questions: what would you have used instead? Would you miss it if it disappeared? Who else
building agents needs this? Short answers are fine.

## Honest limits

- This is **cooperative**: TEND stops only code that asks it. An agent that skips the wrapper, or holds the real credentials itself, can bypass it. Use fake or low-risk actions for the test.
- Use fictional data. TEND records tool names, resources, the exact text you approve, and your decisions, in `.data/` on your machine.
- One sign-in token, no accounts or teams, no notifications. The dashboard must be open to approve. It is a prototype and has had no independent security review.

Stuck for more than five minutes? Tell us instead of struggling: that is a finding. `npm run agents:doctor` checks the common problems (file permissions, saved keys, address).
Remove everything: delete the folder.
