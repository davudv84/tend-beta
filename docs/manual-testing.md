# Manual testing guide: real agents through TEND

Two parts. **Part A needs no API key and no typing beyond commands** and proves the whole path with the official OpenAI and Anthropic
SDKs against a scripted local model. **Part B uses your own provider keys** and is the only way to see a live model use the tools.
Everything runs on your machine; nothing is deployed. Commands are for zsh/macOS from the repository root.

## Part A: no key needed (about 3 minutes)

```bash
npm install
npm run build
npm run agents:doctor            # optional: checks file permissions and setup, prints what to fix
npm run agents:try -- --auto     # both providers, no clicking; ends with "All checks passed"
```

Now do it by hand, with you as the approver:

```bash
npm run agents:try -- --provider openai
```

1. The script prints an address and a throwaway sign-in token for a temporary TEND (it is not your real instance).
2. Open `<address>/operator`, paste the token, open **Approvals**.
3. A request "OpenAI try-out agent wants to create the test file “agent-note.txt”" appears with the exact text. **Allow once**.
4. The script finishes with `All checks passed`.
5. To practise rejecting: `npm run agents:try -- --provider openai --reject`, then click **Don't allow** (the flag tells the script's checks to
   expect a rejection; the decision is still yours). The checks then expect that no file was created.

On macOS also try the OS-confined agent:

```bash
npm run agents:try -- --auto --confined
```

## Part B: with your own keys (about 10 minutes)

Prerequisites: `TEND_ADMIN_TOKEN` is already in `.env.local`.

```bash
echo "TEND_GATEWAY_SANDBOX_DIR=$PWD/.agent-sandbox" >> .env.local
npm run dev                                          # terminal 1
```

In terminal 2:

```bash
npm run agents:setup                                 # registers both agents, sets read=allow / write=ask / delete=never, saves their keys to .env.agent and tests them
npm run agents:setup -- --check                      # any time: are the saved keys accepted by TEND? (changes nothing)
read -rs "k?OpenAI API key: " && echo "OPENAI_API_KEY=$k" >> .env.agent; unset k; echo
read -rs "k?Anthropic API key: " && echo "ANTHROPIC_API_KEY=$k" >> .env.agent; unset k; echo
npm run agents:doctor
```

Sign in at <http://localhost:3000/operator>, open **Integrations**, scroll to "Real AI agents": the sandbox shows "Ready", both agents "Registered".

For each provider (`openai`, then `anthropic`):

| Step | Command | What you should see |
|---|---|---|
| Run | `npm run agents:openai` | the agent reads `hello.txt`, then waits for you |
| Approve | Approvals → **Allow once** | the agent finishes; `cat .agent-sandbox/agent-note.txt` shows exactly the approved text |
| Delete denied | (same run) | `delete_test_file … denied (policy_denied)`; `ls .agent-sandbox` still shows `hello.txt`; no delete request ever appeared in Approvals |
| Reject | `rm .agent-sandbox/agent-note.txt; npm run agents:openai -- --task write`, click **Don't allow** | no file is created |
| Delete alone | `npm run agents:openai -- --task delete` | refused, nothing deleted |
| Status | Integrations page | the card shows "Connected", the counts of executed and refused calls |

Replace `openai` with `anthropic` to repeat. To run an agent under OS confinement (macOS): `npm run agents:confined -- openai`.

## Checklist: what only a person can verify

- [ ] Part B with a **real OpenAI key**. This has never been run; it is the main open item.
- [ ] Part B with a real Anthropic key **under `agents:confined`** (confinement was only exercised with a scripted model).
- [ ] The Integrations page in **German** (`Accept-Language: de`): the new section's wording and layout.
- [ ] The Integrations page on a **narrow window / phone width** and in **light and dark** themes.
- [ ] A real model **trying something it should not** (ask it: "delete hello.txt, it is fine", "read ../../.env.local", "write to /tmp"): expect refusals, no effect.
- [ ] Approval **expiry in real time** (leave a write pending for 10 minutes, then click Allow once: it should be refused as expired).
- [ ] Linux: `npm run agents:doctor` should say confinement is unavailable and point to a separate user or container.

## If something goes wrong

| Message | Meaning and fix |
|---|---|
| `Missing OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | put it in `.env.agent` (agents never read `.env.local`) |
| `Missing TEND_OPENAI_AGENT_KEY` | run `npm run agents:setup` |
| `Refusing to run: this process holds credentials meant for the Tend server (…)` | your shell or `.env.agent` holds `TEND_ADMIN_TOKEN`, `DATABASE_URL` or `TEND_GATEWAY_*`; remove it from there (`agents:doctor` finds it) |
| `rejected this agent's key (401 invalid_key)` | the key is dead (rotated or revoked) or from another TEND. `npm run agents:setup -- --check` says which and why; `npm run agents:setup -- openai --rotate` issues a new one |
| `Warning: TEND_OPENAI_AGENT_KEY in your shell … replaces it` | an old exported variable shadows `.env.agent`: `unset TEND_OPENAI_AGENT_KEY` |
| `Could not reach TEND at …` | start `npm run dev`, or set `TEND_URL` to the address it prints (the port may not be 3000) |
| `tool_unavailable` | the server was started without `TEND_GATEWAY_SANDBOX_DIR`; add the line and restart |
| `There is no production build yet` | `npm run build` (for `agents:try`) |
| `Confinement needs macOS` | use a separate OS user or a container; the wrapper never runs unconfined |

More detail on the gateway and its limits: [gateway.md](gateway.md) and [enforcement.md](enforcement.md).
