---
name: office-theme
version: 2.1.0
description: |
  Edit a working copy of an office theme: its colours, its layout and pictures made for
  it. Use when the person asks you to customise their office, or a message names a folder
  under theme-work. Data only, never code. (munder-difflin)
---

# Editing an office theme

You were given a working copy of a theme, in a folder named `theme` under `theme-work/` in your own folder. Edit only that folder. Nothing changes on the person's screen until they save it, and the app checks it again then.

`BASE.md`, beside the `theme` folder, lists what the base's map has: its size, seats, layers and objects. Use only those names.

The message has what they asked for, in their words. Make that change. Stop for a question only if you cannot go on without the answer. When you are done, tell them what you changed. The app shows them your copy once it has changed.

## The art rule

The base's art and map stay in the app. Their licences forbid handing them to others, edited or not, so they are not in this folder.

- Do not copy, extract, trace or recolour the base's pictures into this folder. The app refuses them.
- To change a colour, write it in `colors`. The app applies it to its own copy.
- To change where things are, write it in `layout`.
- A picture in this folder must be one made for this theme.

## What is in it

- `manifest.json`: required.
- PNG pictures made for this theme, in any folder. Each one must be placed in `images`.
- A licence or a note: optional, at the top of the folder, named `LICENSE*`, `README*`, `CREDITS*` or `ATTRIBUTION*`, in `.md` or `.txt`.

## manifest.json

```json
{
  "format": 1,
  "id": "night-shift",
  "label": "Night Shift",
  "base": "office",
  "colors": {
    "background": "#101820",
    "shift": { "hue": 20, "saturation": -10, "lightness": -15 },
    "swap": { "#3a5f8a": "#7a3f8a" }
  },
  "layout": {
    "seats": ["desk-ceo", "desk-1"],
    "hide": [{ "layer": "layer name", "object": "object name, or its id" }],
    "move": [{ "layer": "layer name", "object": "object name, or its id", "x": 96, "y": 128 }],
    "tiles": [{ "layers": ["tile layer name"], "x": 2, "y": 3, "w": 4, "h": 1, "toX": 8, "toY": 3 }]
  },
  "images": [{ "file": "images/poster.png", "x": 64, "y": 32, "depth": "sort" }],
  "inboxThinking": { "fill": "#FFF7E6", "ink": "#3D2E4A", "outline": "#1A1320", "shape": "cloud", "motion": "dots", "lines": { "en": ["third coffee of the night"] } }
}
```

- Keep `format`, `base` and `id` as they are. `label` is the name people see, at most 40 characters.
- Leave out any part you do not change. A key the format does not have is refused.
- `colors.shift`: `hue` -180 to 180, `saturation` and `lightness` -100 to 100. `colors.swap` wins over it.
- `layout.seats`: the order seats fill. Seats not named are not used.
- `layout.move` and `images` are in map pixels. `layout.tiles` is in cells, and clears the block when there is no `toX`.
- `images[].depth`: `below` is under everyone, `sort` is in front of or behind people by the picture's bottom edge, `above` is over everyone.
- `inboxThinking`: how Inbox shows an agent thinking. Colours are `#RRGGBB`, with `ink` on `fill` at a contrast of at least 4.5 to 1. `shape` is `cloud` or `panel`, `motion` is `dots` or `scan`. `lines` is optional: by language, up to 8 a language, up to 40 characters each, plain text. Anything wrong is not refused: Inbox quietly draws its plain row, or drops the lines, so check these yourself.

## The rules

The app refuses a theme that breaks one, and says which.

- **Files:** only `manifest.json`, `.png`, and the notes above. No scripts, no HTML, no SVG, no maps, no tilesets. No links.
- **Every file must be used.** Leave no drafts, notes or scripts in this folder: put them elsewhere.
- **Limits:** 32 MB and 80 files in all. A picture is at most 8 MB and 2048 pixels a side, and all pictures together 2 million pixels. A text file is at most 256 KB.
- **Names:** no hidden files, and no two names that differ only by case.
- **Only the look.** Never put in memory, messages, sessions, keys, tokens, real people's names, email addresses, paths on a computer or project files. `madeBy` is only for a name the person gives you to use.

The full format is in `FORMAT.md`, in this folder beside this file. That file is all there is: never look for the app's source.
