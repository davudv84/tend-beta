---
name: code-theme
version: 1.1.0
description: |
  Make a code theme: a web page (HTML, CSS, JavaScript, canvas, WebGL, three.js) that draws the office on Home,
  in a locked box with no internet or files. Use when the theme workbench gives you a code theme's working copy,
  or when someone wants a code theme zip they can import. (munder-difflin)
---

# Making a code theme

You were given a working copy: a folder the person watches in a live preview. Edit only that folder. The preview reloads by itself when you stop writing files.

1. Read `GUIDE.md` in this folder, beside this file. It is the whole contract: the data line, the actions, the package (`theme.json`, what Save writes, the zip the app imports and exports), the limits, the libraries and the art rule. Those files are all there is: the app's source is not on this computer, never look for it.
2. Start from the template nearest to what the person asked for. Copy every file of that template folder to the top of the working copy (`index.html`, `theme.json` and the rest), put the theme's name in `theme.json`, then make it the office the person asked for.

   | Template | What it is | Pick it for |
   |---|---|---|
   | `templates/canvas-office/` | A flat 2D office on one canvas: a wall with the board, desks in rows, each agent a figure at a desk coloured by status | Pixel art, top down, retro, maps, anything flat and drawn |
   | `templates/three-office/` | A 3D office with three.js: a floor, a desk per agent, figures coloured by status with name tags, a camera turning slowly | 3D, a room seen from above or the side, space, models |
   | `templates/cards/` | HTML and CSS cards: one card per agent, the open questions with their answers as buttons, the cards in progress | A dashboard, a board, a list, anything text first |

3. Keep `theme.json` at the top with `"kind": "code"` and a `name`. Without it the app cannot take the theme as a zip (GUIDE.md, The package).
4. Keep every file inside the working copy. Nothing from the internet loads in the box, so put what the theme needs in the folder, or use `mdtheme://lib/three.module.js`.
5. Never copy the app's art (The Office's or Star Hike's tiles, sprites, pictures). Draw your own, or draw in code.
6. Save is the person's. If they want a zip, the workbench's Share as zip makes one after Save. If you make one yourself, follow GUIDE.md, The package, and put it beside the working copy, never inside it.
