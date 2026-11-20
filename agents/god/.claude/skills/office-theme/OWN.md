---
name: office-theme-own
version: 1.0.0
description: |
  Make a whole new office on the theme workbench: a theme with base "own" (format 2), its own
  floor plan, tiles, props, seats, cast, lines and look. Read when a message from the theme
  workbench names a working copy. Data only, never code. (munder-difflin)
---

# Making an office of its own

The person asked for a new office in their own words. You make it in the working copy the message names, a folder named `theme`. The person watches a live preview that fills their screen and talks to you through a small chat box. They do not see your terminal.

## How a turn goes

- **Plan the order yourself.** A good one: a style sheet, the tile sheets, the floor plan, the props, the seats, the activities, the cast, the lines, the data shown, the look.
- **Write one part at a time.** The app checks each part as soon as you write it, and the preview draws what passes. A part that fails comes back to you as a message with the reason. Fix it, and say so to the person.
- **Talk to the person only in `replies/`**, beside the working copy: one short plain text file a reply, named `001.md`, `002.md` and so on. Write one at the end of every turn: what you made or changed, and anything they should know. A few sentences, no lists of files.
- **Stop for a question only** if you cannot go on without the answer. Ask it in a reply.
- **Save is the person's.** Finish every part before Save: map, original tiles and props, reachable seats, animated cast, activities, lines, data fields, cover/background and Inbox style. Every character needs its own square headshot PNG with alpha, at least 256 pixels per side and an avatar PNG. Name missing parts while previewing; stand-ins are previews only, never a finished generated theme.

- **A temp only if the work truly needs one**, through the usual temp request. It counts in the token count the person sees.

## How much to make

"Simple" to "rich" are the person's words, not a setting. Pick from what they say, and write the level in `detail`:

| The person asks for | `detail` | Rooms | Props | Frames a row | Lines a moment | Characters |
|---|---|---|---|---|---|---|
| simple, minimal | `minimal` | 3 | 20 | 2 | 3 | 6 |
| (nothing said) | `standard` | 6 | 60 | 4 | 6 | 12 |
| rich, detailed, fun | `rich` | 10 | 160 | 8 | 12 | up to 64 |

The seats are as many as the person asks for, 1 to 64. The count of seats is the most agents the office holds.

## How each part is made

- **The style sheet** is a note for yourself, beside the working copy, never in it.
- **Art** is made by an image model, never drawn by code: the room, props, every cast frame, headshots and the cover. `../simulation-builder/ART.md` says which model, the prompts, and the `tools/sheet.cjs` that cuts, cleans, aligns and packs what it makes (code only does that). Generations and drafts stay beside the working copy; only the finished PNGs go into it. For the bar the shipped simulations meet (every pose row, stops, board, moves, lines in 11 languages), follow `../simulation-builder/BUILD.md`.
- **Seats, rooms, activities, moments and fields** come from the fixed lists below.
- **Names and lines** are written new, in the spirit of the idea. Never copy a show's logo, art, characters' looks or lines, and never use a real person's name.

## The working copy

```
theme/
  manifest.json   required
  map.json        the floor plan
  lines.json      optional: lines by moment and language
  art/*.png       tile sheets, props, the cast sheet, the cover
  LICENSE.md      optional
```

Every file must be used by the theme. Drafts, notes and scripts go beside the copy, not in it.

## manifest.json

```json
{
  "format": 2, "id": "harbour-desk", "label": "Harbour Desk", "base": "own",
  "inspiredBy": "a newsroom on a fishing boat", "detail": "standard",
  "scene": { "cell": 32, "width": 40, "height": 30 },
  "tiles": [{ "file": "art/tiles.png", "cell": 32 }],
  "props": [{ "name": "the kettle", "file": "art/kettle.png", "x": 320, "y": 96, "depth": "sort", "solid": true }],
  "rooms": [{ "name": "the deck", "kind": "desks", "x": 2, "y": 2, "w": 12, "h": 8 }],
  "seats": [{ "name": "Captain", "x": 4, "y": 4, "facing": "down", "room": "the deck" }],
  "cast": { "sheet": "art/cast.png", "frameWidth": 32, "frameHeight": 32, "frames": 4, "characters": [{ "name": "Gull" }] },
  "activities": [{ "kind": "coffee", "at": "the kettle", "weight": 2 }],
  "dataShown": { "tag": ["name"], "desk": ["status", "tool"], "card": ["taskTitle", "context"] },
  "colors": { "background": "#0E1A24" },
  "inboxThinking": { "fill": "#FFF7E6", "ink": "#3D2E4A", "outline": "#1A1320", "shape": "cloud", "motion": "dots" },
  "cover": "art/cover.png"
}
```

Which keys are which part:

| Part | Keys and files |
|---|---|
| Floor plan | `scene`, `rooms`, `map.json` |
| Tiles and props | `tiles`, `props`, their PNGs |
| Seats | `seats` |
| Cast | `cast`, its sheet |
| Activities | `activities` |
| Lines | `lines.json` |
| Data shown | `dataShown` |
| Look | `colors.background`, `inboxThinking`, `cover` |

- Keep `format` 2 and `base` "own". `id` is a-z, 0-9 and "-", at most 40. `label` is the name people see, at most 40 characters. `inspiredBy` is the idea in the person's words, at most 80.
- `scene`: cells of 16 or 32 pixels, at most 2048 by 1536 pixels in all.
- `tiles`: 1 to 8 sheets, each in whole cells of the scene's size. Tiles are numbered across the sheets in order, from 1, row by row. 0 is no tile.
- `props`: at most 160, placed by `x`, `y` in map pixels, top left. `depth`: `below` is under everyone, `sort` is in front of or behind people by the prop's bottom edge, `above` is over everyone. A `solid` prop blocks the cells under its bottom row. A prop has a `name` when an activity is placed at it. A room and a prop never share a name.
- `rooms`: at most 24, in cells. `kind` is one of `desks`, `lead`, `meeting`, `kitchen`, `lounge`, `break`, `entrance`, `quiet`, `outside`, `other`.
- `seats`: 1 to 64, in cells, `facing` one of `down`, `up`, `left`, `right`, on a cell people can walk, two never on one cell. The first seat is the orchestrator's.
- `cast`: frames of 16, 24, 32 or 48 pixels, 1 to 8 frames a row, at most 64 characters. The sheet's 8 rows are fixed: walk down, up, left, right, then sit down, up, left, right. A character is a block of `frames` columns, starting at its `column` (its place in the list times `frames` when left out). Two characters never share a column.
- `activities`: at most 32, `kind` one of `work`, `wander`, `chat`, `coffee`, `break`, `water`, `window`, `fridge`, `shelf`, `bin`, `board`, `mail`, `cheer`, placed `at` a room or a named prop. `weight` 0 to 100, 1 when left out.
- `dataShown`: `tag` at most 2 fields, `desk` at most 3, `card` at most 8, from `name`, `character`, `role`, `status`, `tool`, `station`, `context`, `tokens`, `cost`, `engine`, `taskTitle`, `unread`, `onHold`, `timeInStatus`. Nothing else is ever shown.
- `colors` takes only `background` on an own theme: the art is its own, so there is nothing to recolour. `layout` and `images` are for a shipped base and are refused here.
- `inboxThinking`: as in SKILL.md beside this file.
- `cover`: at most 640 by 400 pixels.

## map.json

```json
{ "layers": [{ "name": "floor", "data": [1, 1, 2, ...] }, { "name": "walls", "data": [...] }],
  "walk": [1, 1, 0, ...], "doors": [{ "x": 0, "y": 5 }] }
```

- 1 to 8 layers, each holding one number a cell, `width` times `height`, row by row. A number is a tile, 0 is none.
- `walk` is 1 where people can walk, 0 where they cannot.
- `doors`: 1 to 16. The first is the entrance. Every door, seat and activity place must be reachable from it in steps up, down, left and right, around solid props.
- At most 1 MB.

## lines.json

`{ "<moment>": { "<language>": ["..."] } }`, at most 24 lines a moment a language, each at most 60 characters, plain text. A simulation adds its talks under `exchanges` and may name a count with a placeholder (FORMAT.md, lines.json).

- Moments: `working`, `idle`, `waiting`, `needsYou`, `blocked`, `compacting`, `looping`, `success`, `error`, `runningTheFloor`, and for activities `gossip`, `cheer`, `water`, `window`, `dispenser`, `fridge`, `shelf`, `bin`, `suckUp`, `coffee`, `brewing`, `refill`, `washing`, `noCleanMugs`, `pinTask`, `takeTask`, `archiveTask`, `blockedTask`, `breakCoffee`, `breakVending`, `breakSnack`, `breakTable`.
- Languages by their codes: `en`, `ar`, `zh-CN` and so on. A moment with no lines in the person's language falls back to English, then to the app's own.

## The rules

The app refuses a part that breaks one, and says which.

- **Files:** only `manifest.json`, `map.json`, `lines.json`, PNG pictures and a licence or note. No scripts, no HTML, no SVG, no Tiled maps. No links.
- **Limits:** 120 files and 32 MB in all. A picture is at most 8 MB and 2048 pixels a side, and all pictures together 6 million pixels.
- **Art:** every picture is made for this theme. No cell of the app's own art, The Office's or Star Hike's, recoloured or not.
- **Only the look.** Never put in memory, messages, sessions, keys, tokens, real people's names, email addresses, paths on a computer or project files. `madeBy` is only for a name the person gives you to use.

The full format is in `FORMAT.md`, in this folder beside this file. That file is all there is: never look for the app's source.

## Full character kit

For every `cast.characters[i]`, write `avatar: "art/avatars/cN.png"` and `headshot: "art/headshots/cN.png"`. A headshot is an original, high-quality square head-and-shoulders portrait, centred with no clipped face or full-body padding; it must depict that character. Keep the animated floor sheet separate. Declare one top-level `orchestrator: { character: 0, seat: 0 }` using valid zero-based indices. Never put an orchestrator flag on characters. Make the lead chair reachable and some chairs face the screen. The generator uses the same importer, file references, limits, art licensing checks and navigation validation as preset packs. No unused files or copied show art.
