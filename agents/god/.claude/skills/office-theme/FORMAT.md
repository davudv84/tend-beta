# The office theme format

An office theme is a folder, shared as a zip. There are two kinds:

- **Format 1, on a shipped base.** It names a base theme that is in every app (The Office or Star Hike), and carries colour changes, layout changes and pictures made for that theme.
- **Format 2, an office of its own** (base `own`). It names no base. It carries its own floor plan, tiles, props, seats, cast and lines, all made for it. See [Format 2](#format-2-an-office-of-its-own) below.

A theme on a shipped base is still written as format 1, so it keeps opening in apps that read only format 1. Only base `own` is written as format 2.

A theme is **data only, never code**. A zip from someone else is untrusted, and so is a folder an agent has edited. The app checks a theme when it comes in, when it is saved, and each time it is read.

A theme holds **the office's look only**. Never agents' memory, messages, sessions, keys, tokens, names of real people or project files.

## Why a theme holds no art from the app

The art of The Office and of Star Hike is licensed to this app. Both licences forbid handing it to others, edited or not (`src/renderer/src/assets/tilesets/LIMEZUASSETS-LICENSE.txt`, `themes/starhike/LICENSE-ARTWORK.md`). So:

- A theme names its base. The app applies the changes to its own copy as it loads.
- A recolour is numbers in `colors`, never a new picture.
- A theme holds no map and no tileset.
- A picture in a theme is one made for it. A picture that holds art from the app, recoloured or not, is refused on the way in and on the way out.
- The Office and Star Hike themselves cannot be exported. Everyone has them.
- The base's credit always stays. It comes from the app, not from the theme.

## The folder

```
my-theme/
  manifest.json          required
  images/poster.png      optional: pictures made for this theme
  LICENSE.md             optional: the licence of those pictures
```

The names of the pictures and their folders are yours. A zip made by zipping the folder is fine: one folder around everything is taken off.

## manifest.json

| Key | Required | What it is |
|---|---|---|
| `format` | yes | The format version: `1`. A higher one is refused, with a message to update the app. Format 2 is only for base `own` |
| `id` | yes | 1 to 40 characters of `a-z`, `0-9` and `-`. If the name is taken, the app picks a free one |
| `label` | yes | The name people see, at most 40 characters |
| `base` | yes | `office` or `starhike` |
| `madeBy` | no | Who made it, as they want to be shown. It travels with the theme |
| `credit` | no | `{ "text", "url" }`: a credit for the pictures, with an `https` link |
| `colors` | no | See below |
| `layout` | no | See below |
| `images` | no | See below |
| `inboxThinking` | no | See below |

A key the format does not have is refused.

### colors

```json
"colors": {
  "background": "#101820",
  "shift": { "hue": 20, "saturation": -10, "lightness": 5 },
  "swap": { "#3a5f8a": "#7a3f8a" }
}
```

- `background`: the colour behind the map.
- `shift`: a change to every colour of the base's tiles. `hue` in degrees, -180 to 180. `saturation` and `lightness` -100 to 100.
- `swap`: exact colours to replace. These win over `shift`.

A theme has no picture of its own for the list. Its card and its import dialog show the base's picture, turned by `shift` with a CSS filter. That is near the floor, not the same. A theme with only `swap` or `layout` changes shows the plain picture.

The characters keep their colours on Star Hike: the app builds each crew member from the sheet's exact shades.

### layout

```json
"layout": {
  "seats": ["Captain", "Helm", "Science"],
  "hide": [{ "layer": "props-deck", "object": "crate" }],
  "move": [{ "layer": "props-deck", "object": 41, "x": 96, "y": 128 }],
  "tiles": [{ "layers": ["Deco"], "x": 2, "y": 3, "w": 4, "h": 1, "toX": 8, "toY": 3 }]
}
```

- `seats`: the order seats fill, by the base's seat names. Seats not named are not used. The first seat of the base stays first, because the orchestrator sits there.
- `hide`: objects to take off the map, by name, or by id when they have no name.
- `move`: objects to put somewhere else, in map pixels.
- `tiles`: a block of cells in these tile layers, in cells. It moves to `toX`, `toY`, or is cleared when there is no `toX`.

A name the base does not have is refused when the theme comes in. If a later app changes the base, a name that is gone is passed over. On The Office, the `spawn-points` and `zones` layers cannot be hidden.

### images

```json
"images": [{ "file": "images/poster.png", "x": 64, "y": 32, "depth": "sort" }]
```

`x` and `y` are the picture's top left corner, in map pixels. `depth` is one of:

- `below`: under everyone.
- `sort`: in front of or behind people, by the picture's bottom edge.
- `above`: over everyone.

Every picture in the folder must be in this list.

### inboxThinking

How Inbox shows an agent thinking, in this theme's look. The same block works in a shipped pack's `theme.json`.

```json
"inboxThinking": {
  "fill": "#FFF7E6",
  "ink": "#3D2E4A",
  "outline": "#1A1320",
  "shape": "cloud",
  "motion": "dots",
  "lines": { "en": ["third coffee of the night"] }
}
```

- `fill`, `ink`, `outline`: `#RRGGBB` only.
- `shape`: `cloud` or `panel`. `motion`: `dots` or `scan`. These are the app's own motions.
- `ink` on `fill` needs a contrast of at least 4.5 to 1.
- `lines`: optional. By language, up to 8 a language, up to 40 characters each. Plain text, with no control or direction characters. No names of real people.

This block never refuses a theme. If a colour, the shape, the motion or the contrast is wrong, or the block is missing, Inbox draws its plain row. A fault in `lines` drops the lines only. Other keys in the block are ignored. The sprite is not in the block: it comes from the theme's cast or its base.

A saved theme carries its own block. It does not take its base's.

## What is allowed

- `manifest.json`, PNG pictures, and notes at the top of the folder named `LICENSE*`, `README*`, `CREDITS*` or `ATTRIBUTION*`, in `.md` or `.txt`.
- At most 32 MB and 80 files. A picture is at most 8 MB, 2048 pixels a side, and all pictures together 2 million pixels. A text file is at most 256 KB. At most 4 levels of folders.

## What is refused

Each refusal gives one reason, with the file it is about. The manifest is checked first, so a zip with no manifest is `broken`, whatever else it holds.

| Reason | What it means |
|---|---|
| `script` | A script, a web page, or text holding one |
| `big` | Over a limit on size or pixels, or a zip that unpacks to more than it says |
| `many` | Too many files |
| `type` | A file type the format does not have, such as a program, a hidden file, a special file, or a picture with parts the app cannot clean |
| `path` | A link, or a name that points outside the folder |
| `svg` | An SVG picture. SVG can hold scripts, so a theme uses PNG |
| `private` | A file nothing uses, or text holding what looks like a key, a token, an email address or a path on a computer |
| `newer` | A format version this app does not know |
| `broken` | Not a theme: no manifest, bad JSON, a damaged file, or a name the base does not have |
| `art` | A map, a tileset or the app's own art, recoloured or not |

Pictures are written again from their pixels when they come in, when they go out and each time they are read: 8 bit RGBA, with clear pixels zeroed. Nothing hidden in a PNG file stays, and only that output reaches the app's picture decoder.

## What the checks cannot do

- Art is recognised by small cells of pixels and by a picture's whole drawn part, including recoloured copies and copies posterised to two colours. A tile redrawn by hand or with noise added is not caught. The licence still forbids it.
- A picture's drawn part of 16 pixels a side or less is too small to compare as a whole, and is only found when it holds one whole 16 by 16 cell of art with at least 3 colours. A picture under 16 pixels a side is not compared at all: it cannot hold a cell. A theme holds at most 80 files, so pictures that small cannot carry a sheet. The licence still forbids it.
- A copy posterised to two colours and placed in a much larger picture is not found when it is under a tenth of what that picture draws.
- Cells of art count across a theme: one cell in each of two pictures is refused, as two in one picture are.
- A straight edge says nothing about whose art it is, so the side of a box is left out of the comparison. A picture that is only a box, stripes or a grid is not taken for art.
- `madeBy` and the words in a note are the maker's. The app can find an email address, but not every real name.
- A theme's visible pixels can carry any data, within the limits on pictures. The format keeps out secret shapes in text. It cannot know a person's name or prose, and it does not read pixels as text.
- The Office's character art is not in the art check, because it is not in the shipped PNG files this check reads.

## Bad themes

A theme that fails its check is left out of the list, with the reason in the log. A hive set to it shows the base, or the default if the base cannot load. It never stops the app from opening.

Themes are kept in `office-themes/` under the app's user data folder, on this computer only.

## Format 2: an office of its own

A theme on base `own` is a whole office the agents make, with its own art and its own floor plan. The floor draws it with the engine that draws Star Hike, so nothing new runs at draw time. Everything in it is data. Activities and the data shown are named from fixed lists the app knows (Fixed lists, below), never scripts.

### The folder

```
my-office/
  manifest.json      required, format 2, base "own"
  map.json           required: the floor plan
  lines.json         optional: lines by moment and language
  art/*.png          tile sheets, props, the cast sheet, the cover
  LICENSE.md         optional
```

Every picture must be named by the manifest, as a tile sheet, a prop, the cast sheet or the cover. A picture named nowhere is refused as `private`.

### manifest.json

The format 1 keys `madeBy`, `credit` and `inboxThinking` keep their meaning, and so does `colors.background`. `layout`, `images`, `colors.shift` and `colors.swap` are for a shipped base: an own theme that has them is refused as `broken`. Its props are its pictures. A key not in this table is refused as `broken`, with the key named.

| Key | Required | What it is | Limits |
|---|---|---|---|
| `format` | yes | `2` | |
| `id` | yes | The theme's name for the app: `a-z`, `0-9` and `-`, starting with a letter or digit. If the name is taken, the app picks a free one | 1 to 40 characters |
| `label` | yes | The name people see | At most 40 characters |
| `base` | yes | `own` | |
| `madeBy` | no | Who made it, as they want to be shown. It travels with the theme | As format 1 |
| `credit` | no | `{ "text", "url" }`: a credit for the pictures, with an `https` link | As format 1 |
| `colors` | no | `{ "background": "#RRGGBB" }`, the colour behind the map, and nothing else | |
| `inboxThinking` | no | How Inbox shows an agent thinking, as in format 1 | As format 1 |
| `inspiredBy` | no | The idea in the person's words, shown on the card | 80 characters, plain text |
| `detail` | no | `minimal`, `standard` or `rich` | |
| `scene` | yes | `{ cell, width, height }`: cells of 16 or 32 pixels, the size in cells | At most 2048 by 1536 pixels |
| `tiles` | yes | Tile sheets: `[{ file, cell }]`. `cell` is the scene's | 1 to 8 sheets, each whole cells |
| `props` | no | Pictures on the map: `{ name?, file, x, y, depth, solid? }`. `x`, `y` are the top left corner in map pixels. `depth` is `below`, `sort` or `above`, as for format 1 images. A solid prop blocks the cells of its bottom row. A named prop can hold an activity | At most 160, inside the map |
| `rooms` | no | `{ name, kind, x, y, w, h }` in cells | At most 24, inside the scene |
| `seats` | yes | `{ name, x, y, facing, room? }` in cells. The first seat is the orchestrator's unless `orchestrator.seat` selects another. The count is the most agents the office holds | 1 to 64, one a cell |
| `cast` | no | `{ sheet, frameWidth, frameHeight, frames, characters: [{ name, column?, avatar?, headshot? }], rows?, scale? }`. `rows` names the sheet's rows (The cast sheet, below). `scale` is how large a frame is drawn on the map; with none it is 1.25 | Frames of 16, 24, 32 or 48 pixels, 1 to 8 frames, 1 to 64 characters. `scale` 0.5 to 2 |
| `orchestrator` | no | `{ character, seat }`, zero-based indices into the cast and seats. Requires an avatar for every character | Existing packs without metadata keep character 0 and seat 0 |
| `activities` | no | `[{ kind, at, weight?, pose?, effect?, secs? }]`. `kind` is an activity from the fixed list or a `moves` id. `at` names a room, a named prop or a stop. `pose` is an idle pose row or `stand`, `effect` an effect, `secs` how long a person stays | At most 32. `secs` 4 to 60 |
| `stops` | no | `[{ name, x, y, facing, room? }]` in cells: named standing spots, each on a walkable cell beside what it is for. A person at a stop faces its `facing` | At most 48, one name each, not a room's or a prop's |
| `moves` | no | `[{ id, pose, effect? }]`: the world's own activities. `id` is a lower camel word, used as an activity's `kind` and as its lines' moment. `pose` is an idle pose row or `stand` | At most 16. `id` at most 24 characters, not an activity or a moment of the fixed lists |
| `hangout` | no | The name of a room or a stop where people gather on a break and two of them talk | |
| `board` | no | `{ x, y, w, h, askMe?, stand? }`: the part of the room art, in map pixels, where the floor pins task notes. `askMe` is `{ x, y, w, h }` in map pixels for questions waiting on the person. `stand` is `{ x, y }`, the cell a person pins a note from | Inside the map |
| `oneOnOne` | no | `{ x, y, facing }`: the cell where an agent on hold or in a 1:1 with the person waits | A walkable cell |
| `waitAt` | no | `{ x, y, facing }`: the cell where a blocked agent waits | A walkable cell |
| `reportTo` | no | `{ x, y }`: the cell where a finished report is handed to the orchestrator. With none, beside the orchestrator's seat | A walkable cell |
| `work` | no | `{ effect, color }`: what a desk shows while its agent works. `effect` is a work effect, `color` a `#RRGGBB` colour | |
| `burst` | no | `{ kind, colors }`: the celebration when a task is done. `kind` is a burst, `colors` `#RRGGBB` colours | 2 to 5 colours |
| `view` | no | `{ x, y, w, h }` in cells: the part of the map the floor shows, scaled to fill its box. With none, a simulation shows the cells people can walk to and a margin round them, and any other theme its whole map | Inside the scene, at least 12 by 8 cells, or the whole of a smaller scene |
| `dataShown` | no | `{ tag, desk, card }`, each a list of safe field names | At most 2, 3 and 8 fields |
| `cover` | no | A picture for the theme's card | At most 640 by 400 pixels |

Names of seats, rooms, props and characters are plain text of at most 40 characters, each unique in its list, case not counted. A room and a prop cannot share a name.

**Tiles** are numbered across the sheets in the order of `tiles`, left to right and top to bottom in each sheet, from 1. 0 is an empty cell.

**The cast sheet** has 8 fixed rows: walk down, up, left, right, then sit down, up, left, right. Each character is a block of `frames` columns starting at `column`. With no `column`, character `i` starts at column `i × frames`. Two characters cannot share a column.

With `rows`, the sheet names its rows from the pose rows (Fixed lists), in that list's order of meaning: it starts with the 8 rows above, in their order, and adds any of the others once each. The sheet is then exactly as many frames tall as `rows` names, and at least as wide as its characters' columns. Walking rows play at about 8 frames a second, seated and working rows at about 3. A sheet with the work rows shows an agent at work; with the carry rows, an agent walking a report; with `cheer`, a finished task; with `talk`, two people talking; with `reach`, a note pinned on the board.

**A simulation's behaviour** is what `stops`, `moves`, `hangout`, `board`, `oneOnOne`, `waitAt`, `reportTo`, `work` and `burst` add. An idle person rests at their desk for 30 seconds, then goes from activity to activity for 30 seconds, standing at a stop or beside a prop (never a random cell), facing its way, in its pose, with its effect, saying its lines. A task done after a minute or more of work earns a cheer, then the report is walked to the orchestrator. A blocked agent waits at `waitAt`; an agent on hold or in a 1:1 waits at `oneOnOne`. A theme without these keys runs as it always has.

**A rich simulation**, one that says `detail: "rich"`, is measured against a shipped one: every pose row, 4 frames a row, at least 6 of the idle activities, at least 4 moves each used by an activity, stops, a hangout, the board with `askMe` and `stand`, `oneOnOne`, `waitAt`, `work` and `burst`, at least 12 lines a moment in each of the 11 languages (`en`, `ar`, `de`, `es`, `fr`, `it`, `ja`, `ko`, `pt-BR`, `tr`, `zh-CN`) for `working`, `idle`, `waiting`, `blocked`, `success`, `cheer`, `report`, `received`, `oneOnOne`, `fourthWall`, each activity and each move, and at least 20 talks a language. The check names each gap as a reason. The theme still passes and runs.

A character’s optional `headshot` is a pack-relative square PNG with an alpha channel, at least 256 pixels per side, such as `art/headshots/c0.png`. All agent portraits prefer the headshot, then `avatar`, then the existing sprite. Missing referenced headshots, non-square headshots and unreferenced files are refused. Generated themes must complete every kit part and supply an avatar and headshot for every character, plus top-level orchestrator metadata, before Save; partial previews may still use stand-ins.

A character’s `avatar` is a pack-relative PNG, for example `art/avatars/c0.png`. It must exist; unreferenced PNGs are still refused. The shared portrait renderer uses this image and falls back to the current sprite portrait when image decoding fails or an older pack has no avatar. Per-character orchestrator flags, out-of-range indices and unknown fields are refused.

### map.json

```json
{ "layers": [ { "name": "floor", "data": [0, 0, 3] }, { "name": "walls", "data": [0, 5, 0] } ],
  "walk": [1, 1, 0], "doors": [{ "x": 0, "y": 0 }] }
```

- `layers`: 1 to 8, drawn in order. `data` holds one tile number per cell, `width × height`, row by row. A layer whose name starts with `above` is drawn over people; the others are drawn under them.
- `walk`: one number per cell, 1 where people can walk.
- `doors`: 1 to 16 cells. **The first door is the entrance**, where people come in.
- A tile number past the tiles the sheets hold is refused.
- Where people can walk is `walk`, less the bottom row of every solid prop. From the entrance, every door, every seat, and every activity's place must be reachable in steps up, down, left and right: a room by any of its cells, a prop by a cell beside it (or under it, when it is not solid). A seat on a cell people cannot walk is refused.

`map.json` may be up to 1 MB, since a map of 128 by 96 cells holds about 110,000 numbers.

### lines.json

```json
{ "idle": { "en": ["checking the charts"] }, "coffee": { "en": ["fresh pot"] } }
```

- Moments come from the fixed list: the status moments `working`, `idle`, `waiting`, `needsYou`, `blocked`, `compacting`, `looping`, `success`, `error`, `runningTheFloor`, and the activity moments under Star Hike's names (`gossip`, `cheer`, `water`, `window`, `dispenser`, `fridge`, `shelf`, `bin`, `suckUp`, `coffee`, `brewing`, `refill`, `washing`, `noCleanMugs`, `pinTask`, `takeTask`, `archiveTask`, `blockedTask`, `breakCoffee`, `breakVending`, `breakSnack`, `breakTable`).
- A simulation's moments too: `report` (walking a report over), `received` (the orchestrator takes it), `oneOnOne`, `fourthWall`, every activity by its kind (`chat`, `break`, `plant`, `read` and the rest of the list), and each `moves` id. At a stop a person says the activity's own lines, else the older moment of its kind, else `idle`. `fourthWall` lines are mixed in at most about 1 in 20; write them nowhere else.
- `exchanges`: `{ "en": [["A says", "B answers"], ["A", "B", "A"]] }`, talks between two people of 2 to 4 lines, at most 48 per language.
- A line may hold these placeholders and no others: `{name}` the person's name, `{done}` tasks done today, `{open}` tasks open, `{tokens}` tokens used, `{idle}` minutes since anyone last worked. A line whose value the app does not have is not said, nor one whose `{done}` or `{open}` is 0. Nothing from the work itself is ever put in a line.
- At most 24 lines per moment per language, each up to 60 characters, plain text with no control or direction characters. `lines.json` may be up to 1 MB.
- A moment with no lines in the person's language falls back to English, then to the app's own lines.

### Fixed lists

- **Activities:** `work`, `wander`, `chat`, `coffee`, `break`, `water`, `window`, `fridge`, `shelf`, `bin`, `board`, `mail`, `cheer`, and the idle ones `plant`, `read`, `sofa`, `stretch`, `look`, `play`, `phone`, `snack`.
- **Pose rows**, in this order: `down`, `up`, `left`, `right` (walk), `sitDown`, `sitUp`, `sitLeft`, `sitRight` (seated), `workDown`, `workUp`, `workLeft`, `workRight` (seated at work), `carryDown`, `carryUp`, `carryLeft`, `carryRight` (walking with a report), then the idle poses `stretch`, `drink`, `read`, `use`, `talk`, `cheer`, `nap`, `crouch`, `reach`.
- **Effects:** `steam`, `zzz`, `sparkle`, `splash`, `notes`, `hearts`, `bubbles`, `pages`.
- **Work effects:** `glow`, `scroll`, `sparks`, `bubbles`, `pages`.
- **Bursts:** `confetti`, `sparks`, `coins`, `bubbles`, `stars`, `petals`.
- **Room kinds:** `desks`, `lead`, `meeting`, `kitchen`, `lounge`, `break`, `entrance`, `quiet`, `outside`, `other`.
- **Safe fields** for `dataShown`: `name`, `character`, `role`, `status`, `tool`, `station`, `context`, `tokens`, `cost`, `engine`, `taskTitle`, `unread`, `onHold`, `timeInStatus`. `tokens` is a usage count, never a credential.
- **Never shown**, whatever a theme says: an agent's last words, prompts, goal, notes, description, seed prompt, folders, project, command and terminal, and any memory, message text, keys, file contents or real people's names. A theme naming a field not on the safe list is refused as `broken`.

### Limits for base own

The format 1 limits hold, except three that are larger because an own theme carries a whole office:

| Limit | Format 1 | Base `own` |
|---|---|---|
| Files | 80 | 120 |
| All pictures together | 2 million pixels | 6 million pixels |
| Map | none | 2048 by 1536 pixels |

Every picture still goes through the art check: no cell of The Office's or Star Hike's art, recoloured or not. On base own each picture is also read as if it had been made 2, 3 or 4 times bigger, from every starting pixel, so the app's art blown up to a larger cell is refused too.

### Sharing and importing base own

- Save in the workbench takes the parts that are ready as they are, checks them again, and keeps them as a theme. It does not rewrite your manifest.
- The zip holds the folder above: `manifest.json`, `map.json`, `lines.json` and `art/` at the top, or inside one folder around everything, which is taken off. A zip with no `manifest.json` is refused as `broken`. A code theme's zip is a different thing: it has `theme.json` with `"kind": "code"` instead (the code-theme skill).
- A shared zip is read back before it is offered: a theme near the limits makes a zip a little larger than its files, and that zip is refused when it is shared, not when someone imports it.
- The theme's card and the import dialog show its `cover`. A theme with no cover shows no picture. The import dialog says it is an office of its own, and when the theme has `inspiredBy` it shows the credit line: "Original work inspired by X. Not made with or endorsed by its owners."
- Deleting an own theme that is in use puts The Office on the floor.

### Ids

A saved own theme's id is `custom:own:<name>`, and one being looked at is `staged:own:<token>`.

## Asking an agent

"Ask an agent" gives a local agent a working copy in its own folder, at `theme-work/<name>-<id>/theme/`, and a skill describing this format (`resources/skills/office-theme/SKILL.md`). `BASE.md`, beside the folder, lists what the base's map has. For a shipped theme the copy is a new theme on that base, holding only a manifest, which starts with the base's `inboxThinking`. Nothing changes until the person saves it, and it is checked again then.
