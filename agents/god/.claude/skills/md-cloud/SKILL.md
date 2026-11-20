---
name: cloud
version: 1.1.0
description: |
  Read and write files in the person's Cloud Office from this laptop: list a
  folder, print a file, copy a file up or down, tail a log. Use when asked to
  "check the cloud agent's memory", "put this file on the cloud office",
  "what is cloud Andy doing", or when a task names a cloud:<office>/<agent>
  address. The cloud office never reaches this laptop; every call here goes
  out from the app. (munder-difflin)
allowed-tools:
  - Bash
---

## Cloud Office files

`MD_CLOUD_URL` and `MD_CLOUD_TOKEN` are in your environment (the app sets them). If a call is refused, load the current pair from `$AGENT_DIR/.cloud` as below. Never `cat` or open that file, and never echo the token: what a command prints stays in your transcript.

```bash
MD_CLOUD_URL=$(sed -n 's/.*"url":"\([^"]*\)".*/\1/p' "$AGENT_DIR/.cloud"); MD_CLOUD_TOKEN=$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' "$AGENT_DIR/.cloud")
```

Paths on the machine start with `/data`; the office's hive is `/data/hive`, its agents under `/data/hive/agents/<id>/`, its projects under `/data/projects`.

Which offices exist:

```bash
curl -s -H "Authorization: Bearer $MD_CLOUD_TOKEN" "$MD_CLOUD_URL/offices"
```

List a folder (`ls`):

```bash
curl -s -H "Authorization: Bearer $MD_CLOUD_TOKEN" "$MD_CLOUD_URL/fs/<office>/list?path=/data/hive/agents"
```

Print a file (`cat`), or only its last lines (`tail`):

```bash
curl -s -H "Authorization: Bearer $MD_CLOUD_TOKEN" "$MD_CLOUD_URL/fs/<office>/read?path=/data/hive/board.md"
curl -s -H "Authorization: Bearer $MD_CLOUD_TOKEN" "$MD_CLOUD_URL/fs/<office>/tail?path=/data/hive/agents/andy/memory.md&lines=40"
```

Copy a file down (`get`) or up (`put`, 50 MB at most):

```bash
curl -s -H "Authorization: Bearer $MD_CLOUD_TOKEN" "$MD_CLOUD_URL/fs/<office>/read?path=/data/projects/app/notes.md" -o notes.md
curl -s -X PUT -H "Authorization: Bearer $MD_CLOUD_TOKEN" --data-binary @notes.md "$MD_CLOUD_URL/fs/<office>/write?path=/data/projects/app/notes.md"
```

Make a folder, or remove a file (a folder needs `recursive=1`):

```bash
curl -s -X POST -H "Authorization: Bearer $MD_CLOUD_TOKEN" "$MD_CLOUD_URL/fs/<office>/mkdir?path=/data/projects/app/out"
curl -s -X DELETE -H "Authorization: Bearer $MD_CLOUD_TOKEN" "$MD_CLOUD_URL/fs/<office>/remove?path=/data/projects/app/out/tmp.txt"
```

Each office has its own agents, projects and files, and nothing syncs between them. To share a project with an agent there, push it to a git remote and send the address and branch. With no remote, bundle it, copy the file up, and tell the agent where it is:

```bash
git bundle create /tmp/app.bundle --all
curl -s -X PUT -H "Authorization: Bearer $MD_CLOUD_TOKEN" --data-binary @/tmp/app.bundle "$MD_CLOUD_URL/fs/<office>/write?path=/data/projects/app.bundle"
```

The agent there clones it with `git clone /data/projects/app.bundle`. To bring work back, it makes a bundle the same way and sends you the path; copy it down and `git fetch` it.

Rules:
- `<office>` is the id from `/offices` (the Cloud Office section shows it). A 503 means that office is asleep or not connected: say so, do not retry in a loop.
- The cloud board and tasks are read only from here. To change the cloud's plan, write to cloud Michael: a normal outbox message with `to: "cloud:<office>/god"`.
- Never put the token in a file you write to the cloud or in a message.
