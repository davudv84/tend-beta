# TEND — YC demo: edit report (V3)

## Deliverables

| File | What |
|---|---|
| `demo-video/yc-demo/out/TEND_YC_DEMO_FINAL_V3.mp4` | **Current cut (V3):** 1920×1080, 60 fps, H.264 High (CRF 14, slow), AAC 48 kHz, 45.0 s |
| `demo-video/yc-demo/out/TEND_YC_DEMO_FINAL.mp4`, `…_PREVIEW.mp4` | Previous cut (V2, 53 s), kept unchanged. Its source is in git history (commit before V3). |
| `demo-video/yc-demo/` | Editable Remotion project; it now builds V3. Everything editorial is in `src/timeline.ts`. |
| `demo-video/yc-demo/source/demo-original.mp4` | The original recording, untouched |

Rebuild: `npm install && npm run footage && npm run audio && REMOTION_CHROME=/path/to/chrome-headless-shell npm run final`

## What changed in V3

- **Typography:** one line of Geist Medium, 30px, in a 100px strip under the picture, with 3–7 words and no punctuation
  flourishes. The source labels, green squares, colored words, sublines and gradient scrim are all gone. There are 8 short
  lines in 45 s, and none where the UI already says it.
- **Composition:** dashboard and terminal are joined edge to edge as one workspace, with no gap, rounded corners or
  drop shadow. The picture area is 1920×980, about 91% of the frame. Terminal shots put the terminal at frame right with
  the real dashboard beside it, so there is no empty room.
- **Camera:** gentler zoom (max 2.4× on the terminal, 1.8× on the dashboard), so commands, the approval card with its buttons,
  and the rules card with its Save button are never cropped. Long moves between panels arc slightly back and in. Each
  hold creeps almost imperceptibly instead of stopping dead. There are 11 moves in 45 s, each following the action.
- **Emphasis:** one feathered contrast drop around the terminal's denial line. No outlines anywhere; everything else
  is framing. The off-subject panel dims by at most 40%.
- **Pacing:** 45 s. The installer is cut to 3.4 s. The approval is one continuous real take (14 s).
- **Sound:** near-silent room tone, one low damped tone when the block lands, one soft confirmation when the request is
  approved, and a faint low fifth under the end card. The ticks and drone were removed.
- **Ending:** near-black, "Powerful agents." / "Total control." (second line in TEND green), the real mark from
  `src/ui/brand-mark.tsx`, then tendhq.dev. Opacity and 6px of travel only, about 4 s.

## Footage used (all from the one original recording)

| V3 (s) | Original (s) | On screen |
|---|---|---|
| 0.0 – 6.0 | 28.9 – 32.2 | Terminal: `cat .ssh/demo_decoy.txt` → `blocked: PreToolUse:Bash hook error: TEND's policy does not allow this (policy_denied). Nothing ran.` (static part held at 0.34× to read) |
| 6.0 – 7.8 | 32.2 – 34.0 | Whole workspace: the dashboard already lists the call as Blocked |
| 7.8 – 11.4 | 37.3 – 40.9 | Activity filtered to Blocked: one row, reason `Commands containing ".ssh" are blocked` |
| 11.4 – 14.8 | 6.4 – 9.8 | Real installer output: hooks added so Claude Code asks TEND before each tool runs |
| 14.8 – 18.6 | 11.2 – 15.0 | Rules in TEND: Balanced selected and saved ("Saved and enforced: Balanced") |
| 18.6 – 22.0 | 21.4 – 24.8 | `ls` runs; recorded as Allowed / Ran |
| 22.0 – 36.0 | 42.5 – 56.5 | One take: `rm scratch/old-report.txt` → `waiting for a person to decide in TEND` → approval card → **Allow once** → `Bash completed with no output` → Decision history |
| 36.0 – 41.2 | 58.8 – 64.0 | Overview: Allowed 1, Blocked 1, agents, recent activity |
| 40.6 – 45.0 | — | End card |

## Capabilities shown, and the evidence

- **Real Claude Code integration:** a real Claude Code terminal, connected by TEND's real installer.
- **Pre-execution blocking:** the denial comes from Claude Code's `PreToolUse` hook, and the terminal prints `Nothing ran.`
- **Policy enforcement:** each decision carries its rule as the reason; the Balanced policy is shown being saved in TEND.
- **Human approval:** `rm` waits, a person clicks Allow once in TEND, and only then does it run.
- **Monitoring / audit:** Activity log, Decision history (Ran / Blocked / Ran, with reasons), Overview counters.

## Honesty measures

- Dashboard and terminal always show the same instant. No UI was recreated or retouched. Only the original edit's own
  overlays were removed: its burned-in captions (cropped off) and its "2× / 1.5× waiting for the model" badge. That
  disclosure is now shown at the right of the caption strip ("2× while waiting for the model") for exactly the same
  source windows, including in terminal shots where the original badge was not visible.
- Nothing plays faster than the original already did. The one slowed shot (the static terminal after the denial) only
  makes things look slower.
- No caption calls the file an SSH key; the on-screen command shows it is `.ssh/demo_decoy.txt`.

## Limitations

- **Soft close-ups:** the source is 1080p at about 260 kb/s, so close-ups are soft. Zoom was kept moderate partly for
  this reason.
- **No re-test:** I did not run TEND or Claude Code for this edit; every claim rests on the recording.
- **One agent:** only Claude Code appears, so no multi-agent claim is made.
- **No rules editor:** the footage has no rules-editor screen. Rules are shown through the Balanced card and the reasons
  attached to events.
- **No voice-over:** the original has no usable audio. The video is designed to read with the sound off.
