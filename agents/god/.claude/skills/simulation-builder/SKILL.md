---
name: simulation-builder
version: 1.1.0
description: |
  Build a new simulation (what the app used to call a theme): how the office looks on Home, for example "make me a
  submarine research lab simulation". Opens the app's workbench on it, or builds it in the background and hands it to
  the app. Two kinds: an office simulation (a map with its own art, cast and lines, where agents walk, sit, work, talk
  and cheer; the default) and a code simulation (a web page that draws the office). Use whenever someone asks for a
  simulation, a theme, or a new look for their office. (munder-difflin)
---

# Building a simulation

A simulation is how the person's office looks on Home. The app keeps them in the Theme panel on Home (older words in the app say "theme"; it is the same thing). There are two kinds:

| Kind | What it is | Its guide, beside this skill |
|---|---|---|
| `office` | A map: its own room, props, seats, cast, lines and look, every picture made for it. Its agents walk to named spots, sit and work at their desks, talk in pairs, pin task notes, cheer a finished task and carry the report to the orchestrator. A lot of art. | `BUILD.md` and `ART.md` in this folder, then `../office-theme/OWN.md` and `../office-theme/FORMAT.md` (Format 2) for every key |
| `code` | A web page that draws the office: HTML, CSS, JavaScript, canvas, three.js. One file can be a whole simulation. | `../code-theme/SKILL.md` and `../code-theme/GUIDE.md`; templates in `../code-theme/templates/` |

**Pick `office`.** That is where the floor's behaviour lives: the poses, the stops, the board, the 1:1 spot, the lines in every language. A pirate ship, a submarine lab, a bakery, a newsroom: all are office simulations. Pick `code` only when the person asks for a web page, 3D, or something a map of people at desks cannot be (a chart, a game, a moving scene with no floor).

There are two roads. Both end in a simulation the app has checked and accepted.

## Road 1: open the workbench (the person is at the app on this computer)

The workbench is the app's own screen for making a simulation: the person sees a live preview, talks to its maker agent and presses Save. You open it for them with one file. Use a new file name each time.

```sh
mkdir -p "$HIVE_ROOT/simulation-requests"
cat > "$HIVE_ROOT/simulation-requests/sim-$(date +%s).json" <<EOF
{ "kind": "office", "agent": "$AGENT_ID", "words": "A submarine research lab: the crew at sonar desks, the task board on the periscope bulkhead." }
EOF
```

- `kind`: `office` or `code`.
- `agent`: your own id, `$AGENT_ID`, so the answer reaches you.
- `words`: what the person asked for, in their words, with anything they added (colours, mood, what each agent should look like). At most 4000 characters.

The app opens the workbench on the person's screen with those words, and its own maker agent builds it there. You get a message, `[simulation] the workbench is open ...`, or `[simulation not taken]` with the reason. Then tell the person it is on their screen. You do nothing more: the maker agent and the person finish it.

Only one simulation is made in the workbench at a time. If one is open, the answer says so: use Road 2.

## Road 2: build it yourself, in the background

Use this road in a Cloud Office (your `$HIVE_ROOT` is `/data/hive`), when the person asked you to just make it, or when the workbench is busy. A Cloud Office never opens the workbench: its maker agent would run on the person's computer.

1. **Make a folder of your own**, never inside a project: `"$AGENT_DIR/simulations/<short-name>/"`. It holds the simulation and nothing else; your drafts, generations and notes go in `"$AGENT_DIR/simulations/<short-name>-work/"` beside it.
2. **Start from what is nearest.** For `office`, follow `BUILD.md` in this folder from its first step: it is the whole run, from the person's one sentence to a simulation at the bar the shipped ones meet, and `ART.md` says where every picture comes from. For `code`, copy every file of the nearest template in `../code-theme/templates/` into it, or of the finished example beside this file, `example/pirate-office/` (a pirate ship made from the canvas template).
3. **Make it what the person asked for.** Follow the guide for the kind, line by line. For `code`, keep `theme.json` at the top with `"kind": "code"` and the name, and `index.html` beside it. Never copy the app's own art (one exception: an office with no image model may borrow the presets' drawn art, `ART.md`). Nothing loads from the internet in the box.
4. **Hand it in** with one file, a new name each time. This one hands in the code example; an office simulation writes `"kind": "office"` and its own folder (`BUILD.md`, Hand it in):

```sh
mkdir -p "$HIVE_ROOT/simulation-requests"
cat > "$HIVE_ROOT/simulation-requests/sim-$(date +%s).json" <<EOF
{ "kind": "code", "agent": "$AGENT_ID", "folder": "$AGENT_DIR/simulations/pirate-office", "name": "Pirate office" }
EOF
```

- `folder`: the absolute path of your folder. In a Cloud Office it is under `/data`.
- `name`: the simulation's name, 1 to 40 characters.

The app runs the same check as the workbench's Save and adds it to the person's simulations. It does not switch to it. You get `[simulation added] <name>`, or `[simulation not taken]` with the reason and the file it names: fix that and hand it in again under a new file name. When it is added, tell the person to pick it in the Theme panel on Home.

## The preset bar

The person should get a simulation as good as the ones the app ships, not a lesser one. An office simulation that says `"detail": "rich"` is measured against them when it is handed in: every pose row, the stops, the board, the 1:1 spot, the moves, at least 12 lines a moment in all 11 languages and 20 talks. When it falls short, the `[simulation added]` answer says so after its usual words ("It is in, but short of the preset bar: ...") and names every gap. `BUILD.md` reaches that bar, and its `check` step finds the gaps before you hand it in. Every hand in adds a new simulation, so hand in once, when the check is clean.

## What the answer means

- The request moves to `simulation-requests/.done/` or `simulation-requests/.failed/` with the outcome, and the gaps when there are some. A request that has not moved has not been read yet: in a Cloud Office the app reads it only while the person's app is connected to the office.
- A refusal names the rule: a missing `theme.json` or `manifest.json`, a file type the box does not take, a file over the limits, a picture of the app's own art, a part of an office kit that is not ready. The guides above list every one.
- Save, Use and Delete stay the person's. You never switch their office to a simulation.
