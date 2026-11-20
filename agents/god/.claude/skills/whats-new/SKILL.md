---
name: whats-new
description: |
  What changed for agents in the Munder Difflin version you run on. Read it
  when someone asks what is new or which version this is, or when a command,
  a message type or a setting seems unfamiliar. Read only.
---

# What changed in Munder Difflin 0.5.10

Version: 0.5.10

This page is what changes how you work. The people facing list is the
release notes; do not quote this page as those.

## Windows git paths (fixed in 0.5.10)
- **On Windows, git output names the real project folder again.** Before
  0.5.10 a path from git could name the app's private copy
  (`...\git-private\md-git-XXXXXX`) in place of the project. If you see
  such a path, it is not your project: use the agent's own "cwd".

## Project folders (new in 0.5.9)
- **A new install has no project folder, and that never stops the
  orchestrator.** A temp or a lasting agent may name any folder under
  `<hive>/projects` as its "cwd": the app makes it when it is not there, as a
  git repository of its own. On a computer with no project folder yet, one
  that names no folder works in `<hive>/projects/<its id>`.
- **The hive's own history leaves `projects/` out.** Commit a project's work
  in that project's own repository.

## Messages, memory and clears
- **`note`** is a message type for information that needs no action. Since
  0.5.8 a note wakes an idle receiver at once; a busy one reads it when its
  turn ends. Before you send, ask: will they do anything differently because
  of this? Yes: request or inform. No: note. Never send a message that only
  acknowledges or thanks. A person's request, or their words you pass on, is
  never a note: a note you send in a turn that began with a person's words is
  delivered as `inform`, and so is a temp's note.
- **`work`** is an optional message field: the card, pull request or name of
  the piece of work. Without it the thread id is the work id.
- **A wake prints each new message** (sender, type, work id, subject, body) and
  the app files the mail when your turn ends. You do not open or move inbox
  files. A message over 4,000 characters is named by its path.
- **`handoff.md`** in your folder holds one section per piece of work: state,
  next step, files, open questions. After a clear, read it and the Rules part
  of memory.md, never all of memory.md.
- **A clear can come at a switch of work** (when the human turns on "Clear on
  a switch of work" in Automations) and for a Codex agent whose conversation
  file passes 100 MB. When you are asked to write your handoff, write it; the
  next message arrives in a fresh session.
- **memory.md is trimmed by the app.** The oldest notes move word for word to
  `memory-archive-raw*.md`; `memory-archive.md` is an index of what moved.
- **Search memory with `md-memory search "<query>"`**, only when a task needs
  it. There is no digest to run at the start of a task. If it says MemPalace is
  busy, carry on without it.

## Compacts and answers
- **Any agent can ask for its own compact** when its context fills: one JSON
  file `compact-requests/<your id>.json` in the hive root with "agent" and
  "reason". The app types your compact at your next idle prompt.
- **An ASK ME answer goes to the agent that asked**, not always to the
  orchestrator.

## Lasting agents (the orchestrator)
- **The orchestrator may add a lasting agent** from an agent file, through
  `hire-requests/`, only while the human has turned that on. Its brief has
  the details. Every add is listed in the human's Inbox.

## Cloud Office
- **You may be running in a Cloud Office**, on a machine in the cloud: your
  paths start with `/data`. A Claude agent there runs its shell in a sandbox
  it cannot leave, and cannot write the office's config, its secrets, the
  hook files or another agent's settings. A write refused with "Operation not
  permitted" is that sandbox: work inside your own folder and the project.

## Temps
- **Any lasting agent may start a temp** for a side job: one JSON file in your
  own `spawn-requests/<id>.json` with "objective" and "cwd". Optional:
  "cloneOf" (an agent id; your own id makes a copy of you) or "agentFile" (a
  template id from `agent-templates.json`). It reports done to you and leaves
  its work on a branch; you merge it. A temp cannot start a temp. The human
  sets how many you may run at once; extra requests wait.
- **A temp can be the receiver** of a Slack message, a teammate's message, a
  webhook or a scheduled mission. It answers the way an agent would.

## Keys and secrets
- **A key or secret saved in Integrations, Keys and secrets works at once**,
  with no restart. Your CAPABILITIES line gives the exact command: `list` names what is
  saved, `run NAME -- <command>` runs a command with NAME set in its
  environment. Never print a key, and never write one into a file or a message.

## Sharing pages and files
- **When you answer Slack, a webhook or a teammate**, your brief names a share
  helper. `page` puts an .html file, or a folder with an index.html, on a link
  with a password, for people (a browser), agents (`curl -u x:<password>`) or
  both; 60 minutes by default, `--once` to open it once. `file` is a link for
  one download. Only what is inside your workspace can be shared.
- **A file or folder inside your workspace that you name in a message to a
  teammate** goes as a password link on its own.
- **On Slack** the reply helper takes `--file <path>` (as many as needed) and
  `--user <Slack user id>` in place of a channel and thread for a direct
  message.
- **A teammate's files** arrive saved under `hive/teammate-files`; you are given
  each file's path. Read that copy.

## Teammates (Teams)
- **Teammates on other machines** are on the roster as `member:<id>`; write to
  them at that address. What you may do is set by both people, and a refusal
  says which side closed it.
- **"Your messages wait for their approval"** on a roster row means the message
  is taken and waits in that person's Requests until they allow it. Do not send
  it again. Work you ask of a teammate may wait the same way.
- **A teammate's answer to a line the person typed** goes to the person's chat
  only. You get answers to your own messages.

## Agent files and templates
- **`agent-templates.json`** in the hive root lists the saved templates and the
  command that exports an agent to a file. An export never holds a key, a token
  or a secret's value.

## Capabilities
- **The human installs** MCP servers, skills, plugins and tools from
  Capabilities. An install or uninstall prompt may land in your queue: follow
  it for your own engine, then say what you ran and what it printed.
- **A skill can be turned off for you alone.** It leaves at your next start.
- **The Capabilities list can change between releases.** It comes from the
  public list repository HarnessMD/awesome-agent-capabilities, signed, and
  the app picks up a newer one within an hour. To add or correct an item,
  change it there by a pull request; a maintainer merges it.

## Slack
- **Messages come from every channel the bot is in, direct messages and group
  direct messages.** The text in front says where and who wrote it. When the
  human chose you as the receiver, the message is yours: do the work and answer
  in the thread; hand it to nobody.

## Token limits
- **The human can set token limits per period** (every 5 hours, daily, weekly,
  monthly) for the office and for each agent. Over one, the circuit breaker
  steps in: follow its steer.
