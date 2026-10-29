# TEND beta: put TEND in front of your agent's tools

You need: the address of your TEND (below: `$TEND_URL`), an account there, Node 18 or newer (or Python 3.10+). No package to install.
TEND only controls the tool calls your code sends through it; see `docs/security-limitations.md` for what that means.

## 1. Account and agent (2 minutes)

1. Open `$TEND_URL/account/sign-up`, create an account, confirm it from the mail. Wait for the approval mail, then sign in.
2. **Connect an agent** → pick your framework → name the agent → **Create**. Copy the key: it is shown once. (Lost it? Create a new key on the
   agent's page; the old one stops working.)

## 2. Try the sample first (2 minutes)

```bash
curl -fsSO $TEND_URL/sdk/tend.mjs && curl -fsSO $TEND_URL/sdk/sample.mjs
TEND_URL=$TEND_URL TEND_AGENT_KEY=tend_sk_... node sample.mjs
```

Every call is blocked: there is no policy yet, and each refusal says which rule to add. The sample prints a policy at the end. In TEND open
**Policies** → your agent → **Edit** → **Rules as JSON (advanced)**, paste it, **Save rules**, and run the sample again:

- `read_record` runs (allowed);
- an email to an `example.com` address runs (allowed by an argument condition);
- an email to any other address waits for you under **Approvals**, and runs once after you approve it;
- `delete_file` never runs.

**Activity** shows every decision with its reason. `node sample.mjs --claude` (with `ANTHROPIC_API_KEY`) lets Claude choose the calls instead.

## 3. Your own agent (a few lines)

```js
import { connectTend, guardTool } from "./tend.mjs";      // the file you downloaded
const gate = connectTend();                                 // reads TEND_URL and TEND_AGENT_KEY
const sendEmail = guardTool(gate, "send_email", (args) => realSendEmail(args));
// give sendEmail to your framework as the tool's function; pass the framework's tool-call id as a 2nd argument if it has one
```

It returns your function's result when TEND allows the call, and a sentence starting with `Not done:` (with the reason and what to change)
otherwise, so the model can tell the user. The Connect page shows the same for the Anthropic SDK, OpenAI Agents SDK, LangChain/LangGraph/
Mastra, Python (`curl -fsSO $TEND_URL/sdk/tend_gate.py`) and MCP hosts (`node tend.mjs -- <your MCP server command>`).

## Policy rules

A rule: `{ "tool": "send_email", "action": "call", "effect": "allow" | "approve" | "deny", "when": { ... } }`. The most specific matching rule
wins; a tool with no matching rule is denied. Put conditional "allow" rules above a catch-all "deny" or "approve" for the same tool.

| Condition | Example |
|---|---|
| `emailDomainIn` | `"to": { "emailDomainIn": ["example.com"] }` (plain addresses only; subdomains are not included) |
| `pathUnder` | `"path": { "pathUnder": ["/data/reports"] }` (no `..`, no backslashes) |
| `in`, `notIn`, `equals` | `"operation": { "in": ["select"] }` |
| `lt`, `lte`, `gt`, `gte` | `"amount": { "lte": 50 }` (numbers only) |
| `startsWith`, `endsWith`, `contains` | `"table": { "startsWith": "prod_" }` (case is ignored) |
| `exists` | `"cc": { "exists": false }` |

All conditions in a rule must hold; for a list argument, every element must. Try a change before saving: **Preview against recorded actions**.

## Measuring your setup time (please do this)

Start a timer when you open the sign-up page; write down the time at each point. Send the numbers with your feedback.

| | Minute |
|---|---|
| Account confirmed (not counting the wait for approval) | |
| Agent created, key copied | |
| Sample run, all blocked | |
| Policy pasted, sample run again with the expected four results | |
| Your own agent's first tool call through TEND seen in Activity | |

## When something goes wrong

| You see | It means |
|---|---|
| `TEND is not reachable at …` | TEND_URL is wrong or TEND is down; nothing ran |
| `does not accept this agent key` | the key was revoked or belongs to another TEND |
| `no rule for X · call yet` | add a rule for that tool (Policies) |
| `already authorized once, and is not run twice` | the same call was repeated after a lost answer; ask again if it really must run twice |
| `the policy or the agent changed before it ran` | the policy was tightened, or the agent paused, between approval and use |

Bugs: `docs/beta/bug-report.md`. Feedback: `docs/beta/feedback.md`.
