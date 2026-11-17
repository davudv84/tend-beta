# TEND — YC demo 2.0: edit report

## Deliverables

| File | What |
|---|---|
| `demo-video/yc-demo/out/TEND_YC_DEMO_FINAL.mp4` | Final: 1920×1080, 60 fps, H.264 (High, CRF 14, preset slow), AAC 48 kHz stereo, 53.0 s |
| `demo-video/yc-demo/out/TEND_YC_DEMO_PREVIEW.mp4` | Preview: the same render downscaled to 1280×720, 60 fps, small enough to share |
| `demo-video/yc-demo/` | Editable Remotion project (React + TypeScript) |
| `demo-video/yc-demo/source/demo-original.mp4` | The original recording, untouched |

Rebuild from scratch:

```bash
cd demo-video/yc-demo && npm install
npm run footage   # splits the original into dashboard/terminal plates (ffmpeg)
npm run audio     # synthesizes the sound design (python3 + numpy)
REMOTION_CHROME=/path/to/chrome-headless-shell npm run final
npm run preview   # 720p copy of the final
```

`npm run studio` opens the timeline in Remotion Studio. Everything editorial is in `src/timeline.ts`
(segments, camera keyframes, highlights, captions, sound cues).

## Footage used (all from the one original recording)

The original is a 76 s, 30 fps screen recording: the TEND dashboard (left, light theme) beside a real Claude Code
terminal (right), with captions burned in. Its audio track is a constant DC offset (no narration), so no original audio
is used.

| New edit (s) | Original (s) | What is on screen |
|---|---|---|
| 0.0 – 5.4 | 28.6 – 32.2 | Claude Code is told to `cat .ssh/demo_decoy.txt`; the real terminal prints `blocked: PreToolUse:Bash hook error: TEND's policy does not allow this (policy_denied). Nothing ran.` |
| 5.4 – 7.5 | 32.2 – 34.3 | Same moment, wider: the dashboard's Activity already lists the call as **Blocked**, reason `Commands containing ".ssh" are blocked` |
| 7.5 – 11.1 | 37.3 – 40.9 | The Activity view filtered to Blocked: the single blocked event |
| 11.1 – 16.1 | 5.3 – 10.3 | The real installer run (`tend-hooks.mjs install claude-code`), which says it adds PreToolUse/PostToolUse/… hooks so Claude Code asks TEND before each tool runs |
| 16.1 – 20.6 | 10.6 – 15.1 | Rules chosen in TEND: Balanced (deletes/publish/sudo/network wait for a person), saved |
| 20.6 – 25.0 | 20.6 – 25.0 | A harmless `ls` runs; dashboard records it as Allowed / Ran |
| 25.0 – 39.6 | 42.5 – 57.1 | One continuous take: `rm scratch/old-report.txt` → terminal shows `waiting for a person to decide in TEND` → Approvals card (`Commands containing "rm " wait for a person`) → **Allow once** clicked → Decision history shows Approved, then Ran → terminal shows `Bash completed with no output` (close-up) → Decision history row: Ran, `Commands containing "rm " wait for a person` |
| 39.6 – 44.9 | 58.8 – 63.8 | Overview: Allowed 1, Blocked 1, agent list, recent activity |
| 44.3 – 53.0 | — | End card (TEND mark from `src/ui/brand-mark.tsx`, Geist, TEND green) |

Not used: the "Connect an agent" setup clicks (0–5 s), connection-check page, the repeated Activity scrolling, the light
explanatory text card and the old end card (64–76 s).

## Capabilities shown, and what proves each

- **Real Claude Code integration** — the terminal is a real Claude Code session (`Claude Code · acme-reports`), connected by TEND's real installer output.
- **Pre-execution blocking** — the denial comes from Claude Code's `PreToolUse` hook and the terminal prints `Nothing ran.`; Claude's own reply confirms the file was not read.
- **Policy enforcement** — the blocked event carries its rule as the reason (`Commands containing ".ssh" are blocked`); the Balanced policy is shown being saved in TEND.
- **Human approval** — the `rm` waits in the terminal, a person clicks Allow once in TEND, and only then does it run.
- **Activity monitoring / audit log** — Activity view, Decision history (Ran / Blocked / Ran with reasons), Overview counters.

## Honesty measures

- Both panels always show the **same instant** of the recording; nothing is composited across time.
- No product UI was recreated, mocked or retouched. The only pixels removed are the original edit's own overlays:
  its burned-in captions (cropped off below the dashboard) and its "1.5× / 2× · waiting for the model" badge, which the
  new edit re-displays itself (top right) for exactly the same source windows, including in terminal close-ups where the
  original badge was not visible. Footage is never shown faster than the original already was.
- One shot is slowed (0:02.2–0:05.4, 0.44×) while the terminal is static after the block, to give time to read it. That
  makes nothing look faster than it was.
- Captions only state what the footage shows. "Blocked before execution" rests on the real `PreToolUse` denial and `Nothing ran.`
- Highlights dim the surrounding UI and frame an element with a hairline; they never change the element.

## Limitations

- **Source resolution/bitrate.** The original is 1080p at ~260 kb/s, so close-ups (up to ~2.4× on source pixels) are soft
  and show some compression. Plates were upscaled with Lanczos before framing; there is no sharper source to use.
- **No live re-test.** I did not run TEND or Claude Code for this edit; every claim rests on the recording.
- **Only one agent appears.** The original captions say "every supported agent"; the footage shows only Claude Code, so the
  new edit does not claim multi-agent coverage.
- **No Rules page footage.** The rules that fired are shown through the reasons attached to events and the Balanced
  policy card, not a rules editor.
- **Audio** is synthesized sound design (room tone, a muted thud on the block, soft UI ticks, two notes when the approved
  command runs, an end chord). There is no voice-over; the video is designed to read with sound off.
- **Duration 53 s**, below the 60–75 s target: the recording holds about that much distinct, real product action, and
  padding it would only slow it down.
- The end card uses `tendhq.dev` as requested; the original recording's card showed `tend-beta-mauve.vercel.app`.
