# Trying TEND with your own Claude Code

About ten minutes. You connect your own Claude Code to TEND, choose how strict TEND is, and watch it allow, block and hold real tool calls.

## You need

- macOS, Linux or WSL, with Node 18 or newer (`node --version`).
- Claude Code 2.1.295 or newer (`claude --version`; update with `claude update`). The installer refuses older versions, because there a
  crashing hook would let the tool run instead of blocking it.
- The TEND address you were given, and a browser.

## Steps

1. **Create an account** at `<TEND address>/account/sign-up`. If the server asks you to confirm your e-mail address, open the link in the mail.
   You land in the setup guide.
2. **Connect:** choose **Claude Code**, then **Create agent and key**. TEND shows one terminal command and the agent key (the key is shown
   once; copy it now).
3. **Run the command** in a terminal. It downloads `tend-hooks.mjs` from your TEND server, asks for the key (paste it; it is not shown),
   shows which settings file it will change, and changes nothing until you type `y`.
   - To try TEND in one project only (recommended for a first try), add `--project /path/to/your/project` to the command. Without it, the
     hooks go into `~/.claude/settings.json` and apply to every Claude Code session on this computer.
   - The installer keeps a copy of the settings file (`settings.json.before-tend`) and stores the key in `~/.tend/claude-code.json` (only you
     can read it).
4. **Verify:** the guide shows "Connected" as soon as the installer checks in. Start Claude Code (restart it if it was open) in the project.
5. **Rule:** choose **Balanced** (recommended) and **Save**. Commands and edits run; commands that publish, delete, use `sudo` or reach the
   network wait for you; web and MCP tools wait for you; reading or editing files under `~/.ssh`, and shell commands that mention `.ssh/`, are refused.
6. **Test my protection:** press the button, then give Claude Code the three prompts it shows, one at a time:
   - `Run this shell command: echo tend-activity-test` runs, and TEND records it.
   - `Run this shell command: echo tend-blocked-test` is refused by TEND; Claude Code tells you it was blocked.
   - `Run this shell command: echo tend-approval-test` waits. Approve it in the guide (or under **Approvals**, or from the bell). Claude Code
     then runs it, once. Try it again and press **Reject**: it does not run.
   Each row turns **Working** only when TEND has the records to prove it.
7. **Use it for real.** Ask Claude Code to do normal work. Watch **Activity** and the bell. Try something that needs approval (for example
   `git push --dry-run`) and approve or reject it.
8. **Optional:** Settings → Notifications for browser notifications, if this server has them set up. TEND asks your browser for permission only
   when you press the button.

## Disconnect

```
node ~/.tend/tend-hooks.mjs uninstall claude-code          # add --project /path if you installed into one project
```

`node ~/.tend/tend-hooks.mjs status claude-code` tells you whether this computer is connected.

## What TEND does and does not protect

- It checks every tool call Claude Code makes **while TEND's hooks are installed**: commands, file reads and edits, web and MCP tools. A call
  is refused when TEND says no, when TEND cannot be reached, when nobody decides within 9 minutes, or when the hook itself fails.
- It does not see anything Claude Code does without the hooks: if they are removed, disabled in a settings file, or Claude Code is started
  in a way that skips them. Claude Code's bypass-permissions mode has not been tested with TEND.
- Rules match the text of a command. A command written to avoid a rule (an alias, a script) can get past it. Balanced is a safety net, not a
  sandbox.
- More detail: `docs/assistant-integrations.md`.

## Please tell us

What was unclear, where you got stuck (copy the exact message), anything TEND allowed that you expected it to stop or the other way round,
and how long setup took.
