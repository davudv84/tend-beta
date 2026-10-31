# Claude Code and Cursor: what TEND checks, and what it cannot

Both connect through the host's own documented hooks, installed by `tend-hooks.mjs` (served at `/sdk/tend-hooks.mjs`). One command from
TEND's Connect page downloads it and runs `install`, which asks for the agent key, shows the settings file it will change, and changes nothing
until the person types `y`. The key goes to `~/.tend/<host>.json` (mode 600), never into the host's settings.

Before each tool call the host runs the hook, which asks TEND through the same authorization every agent uses (`POST /api/v1/authorize`).
A tool call is filed under a kind (`shell`, `file.write`, `file.read`, `web`, `mcp`, `agent`, `other`) with the host's tool name as the action and
the command, path or URL as arguments, so a few rules (the presets in `src/lib/agent-presets.ts`) cover every tool. `agent` is only the
assistant's own bookkeeping (Task, TodoWrite and the like, listed by name); a tool the hook does not know is `other`, which the Balanced and
Strict presets send to a person. Anything without a rule is refused.

| | Claude Code | Cursor |
|---|---|---|
| Hook used for decisions | `PreToolUse`, every tool (`matcher: "*"`) | `preToolUse` |
| Allowed | no output: Claude Code's own permission rules still apply | `{"permission": "allow"}` |
| Refused, rejected, expired, nobody decided in time | `permissionDecision: "deny"` with the reason | `{"permission": "deny"}` |
| Needs a person | the hook waits (up to 9 minutes) while someone approves or rejects it in TEND; an approval is spent once, with exactly the request approved | same |
| TEND unreachable, key refused | blocked | blocked |
| Hook crashes or times out | blocked, because `onFailure: "block"` is set (Claude Code 2.1.295 or later) | blocked, because `failClosed: true` is set |
| Activity | `PostToolUse` reports the outcome, linked to the authorization; `SessionStart`, `SessionEnd`, `Stop` keep "running" accurate | `postToolUse`, `postToolUseFailure`, `sessionStart`, `sessionEnd`, `stop` |
| Tested with the real host | yes, Claude Code 2.1.314 (2026-10-31): `npm run e2e:claude-hooks` (allowed, blocked, approved, rejected, TEND unreachable, crashed hook), `npm run e2e:claude-coverage` (a Write to `.env` held and, rejected, never written; an approval spent once and asked again for the same command; paused agent and revoked key blocked; uninstall), `-- --expiry` (nobody answers: blocked, expired, a late approval refused) | no. Built from Cursor's documentation (cursor.com/docs/agent/hooks) and tested against its documented payloads only. `npm run e2e:cursor-hooks` runs the same checks with a real `cursor-agent`; it needs `cursor-agent login`, which was not done on the test machine, so it has not run. |

What reaches TEND about a tool call: its kind, the tool's name, and a one-line copy of the command, path, URL or MCP tool, with anything that
looks like a secret replaced by `***` (only plain values: a value with `$`, a backtick, quotes or shell operators in it stays visible, so a
command substitution can never hide behind `***`). Line breaks show as `⏎`. Rules see the whole command (up to 3,000 characters, paths and
URLs up to 1,000); anything longer is refused by the hook instead of being checked by halves. The approval card shows the whole command; the
one-line detail elsewhere says when it is shortened. Never file contents, prompts or tool output.

Run as a hook, the script reads its address and key only from the folder it was installed in (`~/.tend` by default), and only from a key
file that is yours and readable by nobody else: environment variables (which a repository's settings can set) cannot point it at another
server or key.

## Where TEND cannot guarantee anything

- **Only while the hooks are installed.** Whoever controls the computer can remove them, edit the settings, or start the assistant without
  them (for example with hooks disabled). TEND then sees nothing; the agent's page shows it as not running.
- **Claude Code's own settings can switch hooks off, and a repository can do it for itself.** Tested 2026-10-31 with Claude Code 2.1.314
  (`npm run e2e:claude-coverage`): with `{"disableAllHooks": true}` in a project's `.claude/settings.json`, a command TEND's policy blocks ran
  and TEND recorded nothing. Open repositories you do not trust with care. Organizations that need hooks enforced should look at Claude
  Code's managed settings; that was not tested here.
- **Claude Code's bypass-permissions mode was not tested** (deliberately not enabled). Whether hooks run when Claude Code is started that way
  is not established here.
- **The before-tool hook is never silent.** Its installed command carries the role (`hook claude-code pre`), so unreadable or incomplete input
  is blocked; the installer refuses Claude Code older than 2.1.295, where a crashing hook would not block.
- **macOS, Linux and WSL only.** The install command uses a POSIX shell, `curl` and Node 18.
- **Cursor:** its documentation does not say a write can be blocked before it happens (`afterFileEdit` only reports). `preToolUse` is
  documented to fire for every tool and to accept `deny`, but no real Cursor run has confirmed it for edits, and its `ask` answer is not
  enforced there (TEND waits for the decision itself and answers allow or deny).
- **What the command says is what TEND judges.** Rules match the command text (`contains`, `startsWith`); a command can be written to avoid a
  rule (an alias, a script that runs something else). The Balanced preset is a safety net, not a sandbox.
- **Monitor only is not protection.** Everything runs and is recorded; only TEND's own test command is blocked.

## Connection status

Worked out from what TEND heard (`src/lib/protection.ts`): **Registered** (nothing yet), **Running now** (activity in the last five minutes),
**Connected · last activity …** (the session has not ended but is quiet), **Not running** (the last session ended normally), **Not heard from
since …** (a session that never ended, silent for more than a day). A registration alone never shows as connected.

## Test my protection

On the agent's page and in the setup guide. The person asks their real assistant to run three harmless `echo` commands. Each row shows
**Working** only when this agent's own records show it after the test started: a reported tool call (activity), TEND refusing
`echo tend-blocked-test` with no run reported (blocking), and a person approving `echo tend-approval-test`, TEND spending that approval and the
run being reported (approval). The rules for the two test commands only ever make a command stricter, so a command that merely starts with
one gains nothing. Server-side checks that involve no assistant are on the Verification page and are not counted here.
