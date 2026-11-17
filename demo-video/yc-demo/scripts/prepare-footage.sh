#!/usr/bin/env bash
# Splits the original recording into two plates the edit frames independently:
#   dash.mp4  - the TEND dashboard (left 1280 px), cropped above the original's burned-in captions
#   term.mp4  - the Claude Code terminal (right 640 px), full height
# The original edit marked its own speed-ups with a "1.5x/2x waiting for the model" badge over the dashboard.
# That badge is painted out here ONLY because the new edit shows the same disclosure itself (src/speed.ts),
# for exactly the same source windows. Nothing else in the frame is altered. Both plates are upscaled 2x
# (lanczos) so the camera's push-ins stay sharp, and encoded with short GOPs for frame-accurate seeking.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=source/demo-original.mp4
OUT=public/footage
mkdir -p "$OUT"
# Source windows (seconds) where the original was sped up; keep in sync with src/speed.ts
BADGE="between(t,18.6,20.5)+between(t,21.8,23.8)+between(t,28.6,30.1)+between(t,31.7,34.2)+between(t,43.6,45.2)+between(t,51.3,53.7)"
ENC="-c:v libx264 -preset slow -crf 12 -g 10 -pix_fmt yuv420p -an -movflags +faststart"
ffmpeg -v error -y -i "$SRC" -vf "drawbox=x=580:y=16:w=360:h=60:color=0xffffff:t=fill:enable='$BADGE',crop=1280:940:0:0,scale=2560:1880:flags=lanczos" $ENC "$OUT/dash.mp4"
ffmpeg -v error -y -i "$SRC" -vf "crop=640:1080:1280:0,scale=1280:2160:flags=lanczos" $ENC "$OUT/term.mp4"
ls -la "$OUT"
