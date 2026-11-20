# Where a simulation's art comes from

Every picture in a simulation is made for it by an image model: the room, every prop, every frame of every character, the headshots, the cover. The one exception is a person with no image model, who may borrow the presets' own drawn art (the last part of this file). Code never draws a character or a piece of furniture, not with shapes, not pixel by pixel, not as a stand in. Code only keys out a background, cuts, downsamples, cleans specks, snaps colours to a palette, mirrors right to left, aligns and packs, and `tools/sheet.cjs` beside this file does all of that.

Keep every generation in your work folder (`$AGENT_DIR/simulations/<short-name>-work/gen/<job>/`): the reference you sent, the prompt, the result. Only finished pictures go into the simulation folder.

## Which image model

Use the first of these the person has. Say which one you used when you tell them it is done.

1. **Codex's own image generation**, on the person's ChatGPT sign in, with no key. It is there when `codex login status` says they are logged in. One call makes one picture; it takes about 1 to 2 minutes; run at most 3 at a time. One folder per job, holding `ref.png` (the reference) and `prompt.txt`:

   ```sh
   cd "$WORK/gen/c0-s1"
   codex exec --skip-git-repo-check -s workspace-write -i ref.png -o last.txt "$(cat prompt.txt)"
   ```

   Every prompt starts: "Use your built-in image generation tool to create ONE image, then save it into the current folder as c0-s1.png and reply with its path." A call without a reference (the room, a first character design) leaves out `-i ref.png`.

2. **An OpenAI or Gemini key the person saved in Settings.** The md-secret helper your instructions name lists the saved names (`md-secret.cjs list`) and runs a command with one of them set (`md-secret.cjs run NAME -- <command>`). Never print a key, never write it to a file. With OpenAI, send the reference and the prompt to its image edit call with its current image model, a transparent background and a size of `1024x1536` or `1536x1024`. With Gemini, use its current image model with the reference attached. The prompts below work for both.

**No image model.** If the person has none of these, ask them to connect one: sign in to Codex with ChatGPT, or save an OpenAI or Gemini key in Settings. That gets art drawn for their world. If they would rather not, build it from the presets' own drawn art (the last part of this file), or offer a code simulation (`../code-theme/SKILL.md`). Never draw the art with code instead.

## The order

1. **The room**, first: it sets the palette, the style and the scale everything else matches.
2. **The cast**: a design for each character, then five pose sheets each.
3. **The props**: desks, chairs and whatever people stand behind or in front of.
4. **Headshots, avatars and the cover.**

Look at every result yourself before you use it, at its full size and again small. Regenerate what does not read; never fix a picture by drawing on it.

## The room

One picture of the whole floor, edge to edge, top down at a three quarter angle like a classic 16 bit RPG interior. It becomes the map's only tile sheet (`sheet room`, BUILD.md), so it holds the floor, the walls, windows, rugs and everything fixed. It does not hold the desks and chairs people sit at, or anything a person walks behind: those are props, drawn over it and sorted with the people.

Prompt pattern:

> Use your built-in image generation tool to create ONE image, then save it into the current folder as room.png. A top down three quarter view retro pixel art map of <the world>, like the interior of a classic 16 bit RPG: <the rooms and areas, left to right, top to bottom>. Crisp hard edged square pixels, a dark one pixel outline on every object, no anti aliasing, no blur, no gradients, a limited palette of <colours>. Leave clear empty floor where the desks go in <the desk area>. No people, no text, no labels, no frame: the whole image is the map, edge to edge.

Then scale it so a person fits it. A standing person is 34 to 38 pixels tall on the map (at `cast.scale` 1), so a door is about 40 pixels tall and a desk about 32 to 48 pixels wide. Measure a door or a doorway in the generated picture, work out the factor that brings it to about 40 pixels, and shrink by it: `sheet shrink room-big.png room.png --px <factor>`. Crop the result to whole cells of 16 pixels; at most 2048 by 1536.

## The cast

### A design for each character

A new world has no sprite to start from, so make one first: it is the reference every pose sheet is drawn from, the way the shipped simulations started from their approved sprites.

> Use your built-in image generation tool to create ONE image, then save it into the current folder as ref.png. The pixel art sprite sheet of ONE character, <name>, <the look: build, hair, face, outfit and its colours, one thing they carry>, in the style of the attached room picture: top down three quarter retro RPG view, crisp hard edged square pixels, a dark one pixel outline, no anti aliasing. 2 columns and 8 rows on a fully transparent background, the two columns two animation frames: walk toward the viewer, walk away, walk left, walk right, seated facing the viewer, seated with the back to the viewer, seated facing left, seated facing right. No chair, no floor, no text.

Attach the room picture as the reference so the palette and outline match. Look at the result: one character, the same in every cell, the outfit and face readable when shown 36 pixels tall. Regenerate until it is. Write the look down once and use the same words in every later prompt for that character.

### Five pose sheets a character

Each sheet is one call with that character's `ref.png` attached: 4 columns (frames) and 5 rows. Row 1 of every sheet is the walk toward the viewer; it is the scale every other row of that sheet is measured by. Left rows are never generated: `sheet char` mirrors the right ones.

| Sheet | Rows |
|---|---|
| s1 | down, up, right, talk, stretch |
| s2 | down, sitDown, sitUp, sitRight, nap |
| s3 | down, workDown, workUp, workRight, read |
| s4 | down, carryDown, carryUp, carryRight, drink |
| s5 | down, use, cheer, crouch, reach |

The prompt, with your world's words in the angle brackets:

> Use your built-in image generation tool to create ONE image, then save it into the current folder as c0-s1.png and reply with its path. The attached image is the approved pixel art of one character, <name>, <the look>. Its two columns are two animation frames and its 8 rows are: walk down, walk up, walk left, walk right, seated facing the viewer, seated with the back to the viewer, seated facing left, seated facing right. Draw a NEW sprite sheet of ONLY this same character in exactly the same pixel art style: same identity, face, hair, outfit, colours, body proportions and the same dark one pixel outline, top down three quarter retro RPG view, crisp hard edged square pixels, no anti aliasing, no blur, no gradients, no glow. Layout: exactly 4 equal columns and 5 equal rows on a fully transparent background, one whole figure centred in each cell, every figure drawn at the same size and the same pixel scale (a standing figure is about 60 percent of a cell's height), wide empty gutters between cells, nothing touching a cell edge, no labels, no text, no numbers, no grid lines, no shadows, no floor, no furniture, no extra characters. Row 1: ... Row 2: ... (one sentence a row, from the list below).

The rows, as the shipped simulations wrote them (put your world's objects in: its work object, its report, its drink, its gadget, its floor chore):

- **down**: walking toward the viewer, 4 frames: left foot forward, feet passing, right foot forward, feet passing.
- **up**: walking away from the viewer (back view, back of the head), 4 frames: left step, pass, right step, pass.
- **right**: walking to the right in side profile, facing the RIGHT edge of the picture (nose, chest and toes point at the right edge), 4 frames: step, pass, other step, pass.
- **talk**: standing facing the viewer, talking with lively hand gestures, a different hand gesture in each of the 4 frames, mouth open in frames 1 and 3.
- **stretch**: standing facing the viewer, stretching both arms high above the head, 4 frames: arms rising, arms fully up, arms up leaning a little, arms relaxing down.
- **sitDown**: seated facing the viewer with knees tucked, exactly like the seated rows of the reference, no chair drawn, slow breathing: 4 nearly identical frames, eyes closed in frame 3 for a blink.
- **sitUp**: seated with the back to the viewer (back of the head, shoulders and back only, exactly like the reference's seated back view row), no chair drawn, 4 nearly identical breathing frames.
- **sitRight**: seated in side profile facing the RIGHT edge of the picture with knees bent forward toward it, like the reference's seated side rows, no chair drawn, 4 nearly identical breathing frames, eyes closed in frame 3.
- **nap**: seated slumped asleep facing the viewer, eyes closed, head nodding lower and back up across the 4 frames, no chair drawn.
- **workDown**: seated facing the viewer, holding <the work object> up at chest height and working on it; the working hand is at a new spot in every one of the 4 frames; no desk and no chair drawn.
- **workUp**: seated with the back to the viewer, working on <the work object> held in front (only the elbows and the tip of it show past the shoulders); the arm moves in every one of the 4 frames; no desk and no chair drawn.
- **workRight**: seated in side profile facing the RIGHT edge of the picture, holding <the work object> in front of the chest and working on it; the hand moves in every one of the 4 frames; no desk and no chair drawn.
- **read**: standing facing the viewer, holding an open book in both hands and reading it, turning a page across the 4 frames. (Make the pages large and light so they read against the outfit.)
- **carryDown**: walking toward the viewer while holding <the report> in both hands at chest height, 4 walk frames.
- **carryUp**: walking away from the viewer (back view) holding the same <report> in front, its ends visible beside the body, 4 walk frames.
- **carryRight**: walking toward the RIGHT edge of the picture in side profile, holding <the report> in both hands in front of the chest, 4 walk frames.
- **drink**: standing facing the viewer, holding <the cup> in one hand, raising it to the mouth to sip in frames 2 and 3, lowering it in frame 4; draw no steam (the app adds it).
- **use**: standing facing the viewer, using <the gadget> with both hands, <how it moves> across the 4 frames.
- **cheer**: a cheering jump with both arms up: frame 1 crouched on the ground ready to jump, frames 2 and 3 high in the air above the ground with arms raised and a big open smile, frame 4 landing back on the ground.
- **crouch**: crouching low facing the viewer, <the floor chore: tending a plant, picking something up, stirring>, moving across the 4 frames.
- **reach**: standing facing the viewer, reaching one arm high up to pin a small paper note on a board above the head (the board is not drawn), 4 frames: arm rising, pinning, pressing, lowering.

The work object, the report, the cup and the gadget are the world's, and the same for every character: a sonar tablet and a sealed sample jar in a submarine lab, a ship's log and a scroll on a pirate ship.

### Cutting them into a sheet

```sh
sheet char --out "$WORK/cast/c0.png" --height 36 \
  --sheet "$WORK/gen/c0-s1/c0-s1.png=down,up,right,talk,stretch" \
  --sheet "$WORK/gen/c0-s2/c0-s2.png=down,sitDown,sitUp,sitRight,nap" \
  --sheet "$WORK/gen/c0-s3/c0-s3.png=down,workDown,workUp,workRight,read" \
  --sheet "$WORK/gen/c0-s4/c0-s4.png=down,carryDown,carryUp,carryRight,drink" \
  --sheet "$WORK/gen/c0-s5/c0-s5.png=down,use,cheer,crouch,reach"
```

`sheet` is the shell function `BUILD.md` sets up. It keys the background (when the picture has none of its own), cuts each sheet into its rows and frames, measures the art's pixel size from row 1, downsamples on that grid (each pixel the commonest colour of its block, never a blur), drops one and two pixel specks, keeps only the largest piece of a reach frame, centres each figure in its 48 pixel frame with the feet on y 45 (the cheer keeps its jump; seated rows sit at y 36, side seats at 41), and mirrors the left rows. `--height` is the standing height in pixels, 34 to 38 (a small creature may be shorter). When a sheet made again comes back in slightly different colours, add `--palette` with a picture of the character at 1x (its earlier `cN.png`): colours close to that palette are snapped to it. It prints each sheet's pixel size, the standing heights, any warning and any row still missing. When a sheet cannot be cut ("found 4 rows of figures, expected 5"), generate it again with "wide empty gutters" said louder; when one row is wrong, generate that sheet again and use only that row (name the others in an earlier `--sheet` so the first one that names a row gives it).

**Look at which way they face.** Image models often draw a "facing right" row facing left, and the left row is its mirror, so people would walk and sit backwards. `sheet char` writes `cN-facing.png` beside the sheet: the first frame of `right`, `sitRight`, `workRight` and `carryRight`, left to right. Open it. Every figure must face the right edge: nose, chest and toes toward it. Run `sheet char` again with `--flip` naming each row that faces left (`--flip right,carryRight`), and look again until all four face right.

Then pack the characters, in the cast's order:

```sh
sheet pack --out "$SIM/art/cast.png" "$WORK/cast/c0.png" "$WORK/cast/c1.png" ...
```

It refuses a sheet of the wrong size and names every empty frame, soft edge, wrong feet line and standing height off the bar.

## Props

Desks, chairs, counters, shelves, the board's object, plants: generate them in a few prop sheets, several props a sheet, each one whole and apart from the others on a transparent background, in the room's style (attach the room picture). Then `sheet shrink props.png "$SIM/art/prop.png" --px <factor> --cut` cuts every piece into its own trimmed file (`prop-0.png`, `prop-1.png` ...); the factor is the one that made the room's door about 40 pixels. Rename them for what they are (`desk-0.png`, `chair-0.png`).

Every seat has its own chair prop and its own desk prop, both `"depth": "sort"`. The app seats a person in the nearest sorted prop within 16 pixels of the seat cell, so the chair's picture must be at the seat. Facing down: the desk is in front of the chair (lower on the map) and covers the lap. Facing up: the desk is beyond it and the person's back is to the viewer. Ask for chairs and desks in the views your seats need.

## Headshots, avatars and the cover

- **Headshot**, one a character: a square portrait, head and shoulders, centred, nothing clipped, on a transparent background, at least 256 by 256, the same character as the sprite (attach its `ref.png`). Generate it at 1024 and `shrink --px 4`.
- **Avatar**, one a character: the same face small, 64 by 64 or so, from the headshot (`shrink --px 16`).
- **Cover**: the simulation's card, at most 640 by 400: the room with a few of its people, generated from the room picture.

Then follow `BUILD.md` from where you left it.

## No image model: the presets' own art

Only when the person has no image model and would rather not connect one. The six presets' characters, desks, chairs and rooms were drawn for the app, and a simulation may borrow them. Star Hike's and the classic office's pictures are licensed: never those (the hand in refuses them). In a Cloud Office there is no preset art; `sheet reuse` says so, and a code simulation is the road there.

```sh
sheet reuse --preset open-seas --list           # its characters, their scale, its seats and props
sheet reuse --preset open-seas --character "Nami Wave" --out "$WORK/cast/c1.png" \
  --avatar "$SIM/art/avatars/c1.png" --headshot "$SIM/art/headshots/c1.png"
sheet reuse --preset wizard-school --room --out "$SIM"   # its floor, map, desks and chairs, and room-keys.json
```

The presets are `open-seas` (One Fragment), `playroom` (Toy Tale), `neon-district` (Cyber Dunk), `executive-wing` (Off-white House), `hacker-house` (South of Market) and `wizard-school` (Hurry Porter).

- **People.** Pick the ones who fit the world, one per seat, and give each a new name that fits the drawing and the world, never the preset's name. Take them from one preset, or from presets with the same scale (`--list` shows it), and set `cast.scale` to it. Then pack them as in "Cutting them into a sheet". Their faces come with them.
- **A room.** Merge `room-keys.json` into `manifest.json` and delete it. Rename every room, seat, stop and move for the world and write their lines (`BUILD.md` steps 5 to 7); keep where they are. A room you can't draw and won't borrow means there is no office simulation to make: offer the code road.
- **Still yours:** the world, every name, every line in eleven languages, the board's words. Leave the cover out; the app draws a small plan of the floor for the card.
- **Tell the person** which preset's art it borrows, and that connecting an image model would draw their own.
