# One sentence to a simulation at the preset bar

The person said one sentence, "make me a submarine research lab simulation". This is the whole run from there to an office simulation as good as the ones the app ships: its agents walk to named spots and do the world's own things there, sit and work at their desks, talk in pairs, pin task notes on a board, wait at their spot when blocked, cheer a finished task and carry the report to the orchestrator, and say lines in the person's language. Do every step, in order. Plan on a few hours; most of it is waiting on the image model.

Every key below is in `../office-theme/FORMAT.md` (Format 2, with its exact shapes and limits) and `../office-theme/OWN.md`. Where the art comes from, and every prompt, is in `ART.md` beside this file.

## Before you start

Two folders, never inside a project:

```sh
SIM="$AGENT_DIR/simulations/deep-lab"        # the simulation: only files it uses
WORK="$AGENT_DIR/simulations/deep-lab-work"  # generations, references, drafts, notes
mkdir -p "$SIM/art/avatars" "$SIM/art/headshots" "$WORK/gen" "$WORK/cast"
sheet() { "${HIVE_NODE:-node}" "$AGENT_DIR/.claude/skills/simulation-builder/tools/sheet.cjs" "$@"; }
```

Every shell starts fresh, so set these three again in each one. `sheet` cuts, cleans, packs, previews and checks; it never draws (its head lists its commands). No image model, and the person won't connect one? Read the last part of `ART.md` first: the art is borrowed from the presets, the rest of this run is the same.

## 1. The concept and its words

Write `$WORK/CONCEPT.md`, a page at most:

- **The world** in a line, and its rooms: where the desks are, where people rest, where they meet, where the board is.
- **Its words**: what a desk's work object is (a sonar tablet), what a report is (a sealed sample jar), the drink (a tin mug of cocoa), the gadget (a handheld scanner), the floor chore (wiping a porthole), what the crew are called (crew, divers, researchers: never "temp", which means only a short lived helper, and never "worker").
- **4 to 6 moves**, the world's own activities, each with a pose and an effect: `checkSonar` (use, sparkle), `feedFish` (crouch, bubbles), `calibrate` (reach), `logSample` (read, pages).
- **The cast**: one character for each seat, 6 to 12 of them. For each: a name that fits the drawing, and the look in one sentence (build, hair, face, outfit and its colours, one thing they carry). Character 0 is the orchestrator and sits at seat 0. Never a real person, never a character, name, logo or catchphrase from a show, film, game or book: inspired by is fine, copied is not.
- **The celebration** (`burst`: confetti, sparks, coins, bubbles, stars or petals, in 2 to 5 of the world's colours) and **what a working desk shows** (`work`: glow, scroll, sparks, bubbles or pages, in one colour).

## 2. The room

Generate the room as `ART.md` says (The room), shrink it so a door is about 40 pixels tall, crop it to whole 16 pixel cells, and put it in the simulation:

```sh
sheet room "$SIM/art/room.png" --cell 16 --out "$SIM/map.json"
```

It writes `map.json` (the room picture as the map's one layer, every cell walkable, a door to move) and prints the `scene` and `tiles` keys for the manifest. Leave the desks and chairs out of the room picture: they come as props in step 4.

## 3. The cast

For each character, a design and five pose sheets, then cut and pack them (`ART.md`, The cast). The bar:

- Frames are 48 by 48 pixels, 4 a row, the 25 pose rows in their fixed order: `down up left right sitDown sitUp sitLeft sitRight workDown workUp workLeft workRight carryDown carryUp carryLeft carryRight stretch drink read use talk cheer nap crouch reach`.
- A standing figure is 34 to 38 pixels tall in its frame, centred, feet on y 45. Seated rows sit at y 36 (facing down or up) and y 41 (facing sideways).
- Each side row faces the way it is named: `right`, `sitRight`, `workRight` and `carryRight` face the right edge, and their mirrors the left. A row drawn the wrong way makes people walk backwards: look at each `cN-facing.png` and `--flip` it (`ART.md`, Cutting them into a sheet).
- The same identity, outline and palette in every row; readable at 1x; alpha only fully on or fully off.
- The app plays walking at about 8 frames a second and seated rows at about 3: nothing to set, but a seated row that jumps between frames will jitter, so its 4 frames must be nearly the same.

```json
"cast": { "sheet": "art/cast.png", "frameWidth": 48, "frameHeight": 48, "frames": 4, "scale": 1,
  "rows": ["down","up","left","right","sitDown","sitUp","sitLeft","sitRight","workDown","workUp","workLeft","workRight","carryDown","carryUp","carryLeft","carryRight","stretch","drink","read","use","talk","cheer","nap","crouch","reach"],
  "characters": [{ "name": "Captain Mira", "avatar": "art/avatars/c0.png", "headshot": "art/headshots/c0.png" }] },
"orchestrator": { "character": 0, "seat": 0 }
```

`scale` (0.5 to 2) is how large a frame is drawn on the map: 1 when the room was shrunk so a door is about 40 pixels. Raise it a little only if people look small beside the furniture in the preview.

## 4. Props, seats and the map

- **Props**: generate and cut them (`ART.md`, Props). Each one `{ "name", "file", "x", "y", "depth", "solid" }` in map pixels. Desks and chairs and anything a person walks behind are `"depth": "sort"`; rugs and floor marks `below`; hanging lamps `above`. At most 160.
- **Seats**: 1 to 64, `{ "name", "x", "y", "facing", "room" }` in cells, each on a walkable cell with its own chair prop at it (the app seats a person in the nearest sorted prop within 16 pixels) and its desk on the side it faces. Seat 0 is the orchestrator's, near where reports are handed in. Make some seats face the viewer.
- **Rooms**: `{ "name", "kind", "x", "y", "w", "h" }` in cells; one of them is where the desks are.
- **Walk**: in `map.json`, set `walk` to 0 on every cell a person cannot stand on: walls, water, furniture, the desks (not the seat cells). Move `doors[0]` to the real entrance. Every seat, stop and spot must be reachable from it.
- **The view** (optional): `"view": { "x", "y", "w", "h" }` in cells, the part of the map the floor shows, at least 12 by 8. With none, the app shows the cells people can walk and a margin.

## 5. Where people go and what they do

```json
"stops": [{ "name": "Sonar bank", "x": 30, "y": 9, "facing": "up" }, { "name": "Fish tank", "x": 12, "y": 20, "facing": "left" }],
"activities": [
  { "kind": "work", "at": "Lab", "weight": 10 },
  { "kind": "chat", "at": "Mess table", "weight": 3, "pose": "talk", "secs": 14 },
  { "kind": "coffee", "at": "Galley", "weight": 4, "pose": "drink", "effect": "steam", "secs": 12 },
  { "kind": "checkSonar", "at": "Sonar bank", "weight": 3, "pose": "use", "effect": "sparkle", "secs": 16 }
],
"moves": [{ "id": "checkSonar", "pose": "use", "effect": "sparkle" }, { "id": "feedFish", "pose": "crouch", "effect": "bubbles" }],
"hangout": "Mess table",
"board": { "x": 454, "y": 208, "w": 94, "h": 46, "askMe": { "x": 423, "y": 207, "w": 26, "h": 47 }, "stand": { "x": 33, "y": 18 } },
"oneOnOne": { "x": 12, "y": 9, "facing": "left" },
"waitAt": { "x": 33, "y": 26, "facing": "down" },
"reportTo": { "x": 27, "y": 12 },
"work": { "effect": "bubbles", "color": "#9FE3F0" },
"burst": { "kind": "bubbles", "colors": ["#9FE3F0", "#F7D154", "#FFFFFF"] }
```

- **Stops**: 12 to 48 named standing spots in cells, each on a walkable cell right beside the thing it is for, facing it. Never two on one cell; a stop's name is not a room's or a prop's.
- **Activities**: at most 32. `work` at the desks' room; `chat` at the hangout; at least 6 of the idle kinds `plant read sofa stretch look play phone snack`; the others you want (`coffee`, `water`, `window`, `shelf`); and one for each move. Each one `at` a stop, with the `pose` it is done in (an idle pose row or `stand`), its `effect` (`steam zzz sparkle splash notes hearts bubbles pages`) and `secs` 4 to 60. Leave out `wander`: nobody should stop on a random cell.
- **Moves**: 4 to 16, `id` a lower camel word of at most 24 characters that is not an activity kind, a lines moment or `exchanges`. Every move is done by an activity.
- **Hangout**: a room or a stop where two people meet on a break and talk.
- **Board**: in map pixels, the part of the room art where task notes are pinned (draw a board, a pinboard, a screen in the room for it); `askMe` the corner for questions waiting on the person; `stand` the walkable cell a person pins from.
- **oneOnOne**: where an agent on hold or in a 1:1 with the person waits. **waitAt**: where a blocked agent waits, near the entrance or the orchestrator. **reportTo**: where a report is handed over; with none, beside seat 0.
- **The rest of the manifest**: `"format": 2`, `"base": "own"`, `id`, `label` (the name, at most 40), `inspiredBy` (the person's idea, at most 80), `"detail": "rich"`, `dataShown`, `colors.background`, `inboxThinking`, `cover` (`../office-theme/OWN.md` shows each).

## 6. Lines

`lines.json` is `{ "<moment>": { "<language>": ["line", ...] }, "exchanges": { "<language>": [["A", "B"], ["A", "B", "A"]] } }`. Write English first, all of it, then translate.

- **Moments**: `working`, `idle`, `waiting`, `blocked`, `success`, `cheer`, `report` (walking a report over), `received` (the orchestrator takes it), `oneOnOne`, `fourthWall`, every activity kind you use (bar `work`), and every move id. `needsYou` too, if you like.
- **How many**: 12 to 24 lines a moment, at least 20 exchanges of 2 to 4 lines (at most 48), at least 12 `fourthWall`.
- **Each line** is at most 60 characters: it is a speech bubble. Plain text, no dash of any kind, no emoji walls.
- **Placeholders**, only these: `{done}` tasks done today, `{open}` tasks open, `{tokens}` tokens used today, `{idle}` minutes since the last task, `{name}` the person's name. The app skips a line whose `{done}` or `{open}` is 0, and today it keeps no name for the person, so a `{name}` line is never said: leave `{name}` out. Nothing from the person's work ever goes in a line: no file, task, prompt or project.
- **Humour**: the world's own jokes (pressure, sonar pings, the fish who audits everyone), and jokes about being an AI (tokens, the context window, hallucinating, the newer model, prompt injection, "as a large language model"). `fourthWall` lines know they are in an app on someone's screen; that pool is mixed in at most about 1 line in 20, so never write fourth wall lines into other moments. Never mean, never about real people, no politics, nothing for adults only, no brand names.
- **Words**: the crew are agents or the world's own word; "temp" only ever means a short lived helper; never "worker"; never a fixed name for the orchestrator.

## 7. Eleven languages

Every moment and the exchanges in `en ar de es fr it ja ko pt-BR tr zh-CN`. Natural lines that keep the joke, not word for word. `ja` lines are in Japanese, `ko` lines have no Chinese characters or kana, `tr` lines no Hangul, every one at most 60 characters in its own script. Placeholders stay exactly as they are. Arabic: word lines so they do not assume the reader's gender.

## 8. Headshots, avatars, cover, look

`ART.md`, Headshots: one headshot (square, at least 256, alpha) and one avatar a character, a cover at most 640 by 400, then `colors.background`, `inboxThinking` (ink on fill at a contrast of at least 4.5 to 1) and `dataShown`.

## 9. Look at it

```sh
sheet preview "$SIM" --out "$WORK/preview-1x.png"
sheet preview "$SIM" --out "$WORK/preview-3x.png" --zoom 3
sheet preview "$SIM" --out "$WORK/preview-clean.png" --zoom 2 --clean
```

The preview draws the room, the props in depth order, a character seated at every seat (as the app seats them) and one standing at every stop. With marks: red cells cannot be walked; cyan seats, yellow stops, blue doors, magenta 1:1 spot, orange wait spot and `askMe` box, white report spot, green board and its stand; numbers every 4 cells. It is a picture this tool makes, not the app: the app's floor is the final word.

Open every one with your own image reading and go through this list. Fix what fails and look again.

- Every seated person sits in their own chair, facing the way the seat faces, the desk in front of them, not floating, not cut off, not inside the desk.
- Every standing person at a stop stands on floor beside the thing the stop is for, not in a wall or a piece of furniture, and every move's stop has its object.
- Red covers walls, water and furniture, and nothing else; every stop, seat and spot is on an unmarked cell joined to the door.
- The board box sits on the board in the art.
- At 1x a person reads: face, hair and outfit. People are the same size as each other and right for the doors and desks.
- Nobody walks backwards: every `cN-facing.png` shows four figures facing the right edge.
- No prop has a box or halo around it, and the colours of people and props sit in the room.

## 10. Check, then hand it in

```sh
sheet check "$SIM"
```

It measures the folder as the app does when it is handed in (every pose row, 4 frames, 6 idle kinds, 4 moves each used, stops, hangout, board with `askMe` and `stand`, 1:1 spot, wait spot, `work`, `burst`, 12 lines a moment in all 11 languages, 20 exchanges) and the line rules the app refuses on (over 60 characters, a brace that is not a placeholder, more than 24 lines). Make it print nothing in `gaps`, `refused` or `style`.

Then hand it in, once (each hand in adds a new simulation):

```sh
mkdir -p "$HIVE_ROOT/simulation-requests"
cat > "$HIVE_ROOT/simulation-requests/sim-$(date +%s).json" <<EOF
{ "kind": "office", "agent": "$AGENT_ID", "folder": "$AGENT_DIR/simulations/deep-lab", "name": "Deep Lab" }
EOF
```

- `[simulation not taken]` names the rule and the file: fix it, `sheet check` again, hand it in under a new file name.
- `[simulation added]` with "It is in, but short of the preset bar: ..." names each gap: fix them all, check, hand it in again, and tell the person the newer one is the finished one (they can delete the older in the Theme panel).
- `[simulation added]` alone: done. Tell the person its name, that it is in the Theme panel on Home, and which image model made its art. Never switch their office to it yourself.
