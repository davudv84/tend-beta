# TEND — YC demo: edit report (V4, with voiceover)

## Deliverables

| File | What |
|---|---|
| `out/TEND_YC_DEMO_FINAL_V4.mp4` | **Current cut (V4):** 1920×1080, 30 fps, H.264 High, AAC 48 kHz, 46 s, with the stand-in voiceover |
| `out/TEND_YC_DEMO_FINAL_V4_NO_VOICEOVER.mp4` | Same picture, cues only: to record your own voice over |
| `out/TEND_YC_DEMO_FINAL_V3.mp4` | Previous cut (V3, 60 fps, no voice), unchanged |
| `out/TEND_YC_DEMO_FINAL.mp4`, `…_PREVIEW.mp4` | V2, unchanged. V2/V3 sources are in git history. |
| `voiceover/script.json` | The voiceover script with the start time of every line |

All paths are relative to `demo-video/yc-demo/`.

## The voiceover is a synthetic stand-in, not the founder

I can't record your voice, and a cloned or "founder-style" voice presented as yours would be fabricated. V4 is
narrated by **Kokoro** (an open-weights text-to-speech model, voice `af_heart`), run locally. For YC, replace it with your own voice:

1. Record each line of `voiceover/script.json` as its own file: `voiceover/founder/l1.wav`, `l2.wav`, … (a phone recording in a quiet room is fine).
2. Run `npm run audio && npm run final`.

Any line you record replaces the synthetic one at the same moment; lines you don't record keep the stand-in.
Keep each line within about ±10% of the stand-in's length, or adjust its `at` time in `script.json`.

| Line | Starts | Text |
|---|---|---|
| l1 | 0.1 s | AI agents can execute commands. Who controls what they're allowed to do? |
| l2 | 4.6 s | Here, Claude Code tries to read a decoy file in .ssh. The TEND hook denies it before it runs. |
| l3 | 11.4 s | The block is logged, with the rule that stopped it. |
| l4 | 14.1 s | TEND installs as Claude Code hooks, so every tool call is checked. The rules live in TEND. Everyday commands just run, and get recorded. |
| l5 | 23.4 s | Deleting a file needs approval. Claude Code waits, and the exact request shows up in TEND. |
| l6 | 29.7 s | I allow it once. |
| l6b | 32.6 s | Only then does it run. |
| l7 | 34.4 s | Allowed, blocked, approved. Every decision is recorded, with its reason. |
| l8 | 41.8 s | TEND. Powerful agents. Total control. |

Every sentence describes something visible on screen at that moment.

## Structure (output time ← original recording time)

| V4 | Original | Section · on-screen text · what is shown |
|---|---|---|
| 0.0 – 3.8 | 27.0 – 30.8 | **Hook.** "AI agents can execute commands." / "Who controls what they're allowed to do?" Claude Code is given `cat .ssh/demo_decoy.txt` and attempts it. |
| 3.8 – 7.8 | 30.8 – 34.8 | **Blocking.** "Blocked before execution." The real terminal shows `blocked: PreToolUse:Bash hook error: TEND's policy does not allow this (policy_denied). Nothing ran.`, then Claude's own account that the file was not read. |
| 7.8 – 13.9 | 35.0 – 41.1 | TEND Activity: the Blocked row (reason `Commands containing ".ssh" are blocked`), then the Blocked filter clicked. |
| 13.9 – 16.7 | 6.6 – 9.4 | **Policy.** "Define rules. Enforce them automatically." The installer output: hooks added (PreToolUse, PostToolUse, …) so Claude Code asks TEND before each tool runs. |
| 16.7 – 20.0 | 11.4 – 14.7 | Rules in TEND: Balanced, Save clicked. |
| 20.0 – 22.9 | 22.0 – 24.9 | Activity: `ls` Allowed / Ran, "All commands run and are recorded". |
| 22.9 – 36.2 | 42.6 – 55.9 | **Approval**, one continuous real take. "Sensitive actions require approval." `rm scratch/old-report.txt` → `waiting for a person to decide in TEND` → the approval card (exact request, reason) → **Allow once** clicked → `Bash completed with no output` → Decision history. |
| 34.2 – 40.9 | 53.7 – 63.7 | **Visibility.** "Every decision recorded." Decision history (rm Ran, cat Blocked, ls Ran, each with its reason), then the Overview (Allowed 1, Blocked 1). |
| 40.9 – 46.0 | — | **Ending.** Black screen, TEND mark, "Powerful agents. Total control.", tendhq.dev. |

## Editing choices

- **Readability:** terminal close-ups fill the frame width, so mono text is about 37 px tall on screen, roughly 1.6× V3.
  Dashboard shots crop to a single table or card (about 2× the source). Nothing important is cut off: commands,
  status lines, the approval card with both buttons, and the history with reasons are all fully in frame.
- **Transitions:** hard cuts between scenes. The approval take uses short (1 s) camera moves between terminal and
  dashboard, because they show one continuous real interaction.
- **Dead time:** cut where possible. Waiting inside the approval take is kept, because it is the human's real
  decision time. Where the original recording was already sped up while waiting for the model, the right side of the
  caption strip says so (e.g. "2× while waiting for the model"). Nothing plays faster than the original.
- **Audio:** voiceover at −16 LUFS, one quiet low tone when the block lands, and one very soft tone when the
  request is approved. No music; it didn't improve this.
- **Captions:** the exact section texts from the brief, in a quiet strip under the picture.

## Resolution

The only footage is `source/demo-original.mp4`: 1920×1080, 30 fps, about 260 kb/s. Any zoom therefore enlarges source
pixels (up to about 3× in terminal close-ups, 2× on the dashboard). I did one Lanczos resample before framing, which
is sharper than the browser's own scaling, and added no AI upscaling or sharpening. Text is clearly readable but soft.
**The single biggest improvement available is a sharper source recording:** record the same session again at 2× / 4K (or on a Retina
screen at native resolution), with a higher bitrate (≥ 20 Mb/s). Then put it at `source/demo-original.mp4`, re-check
the source times in `src/timeline.ts`, and run `npm run footage && npm run final`.

## Capabilities shown, and the evidence

- **Claude Code hook-based enforcement:** the installer output (hooks added to Claude Code's settings) and the
  `PreToolUse:Bash hook error … Nothing ran.` denial in the real terminal.
- **Policy enforcement:** the Balanced rules saved in TEND; every decision carries its rule as the reason.
- **Human approval:** `rm` waits, a person clicks Allow once, and only then does it run.
- **Audit:** the Activity log, the Decision history and the Overview counters.

**Not claimed:** other agents or integrations, performance figures, or a rules editor (none is in the footage). The
`.ssh` file is called a decoy, which is what it is.

## Not verified

I did not run TEND or Claude Code for this edit; every claim rests on the recording.
