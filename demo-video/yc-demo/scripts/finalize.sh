#!/usr/bin/env bash
# Remux the Remotion render with the moov atom up front (instant start when opened/streamed); no re-encode.
set -euo pipefail
cd "$(dirname "$0")/.."
ffmpeg -v error -y -i out/render_raw.mp4 -c copy -movflags +faststart out/TEND_YC_DEMO_FINAL.mp4
rm -f out/render_raw.mp4
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,bit_rate -show_entries format=duration,size -of compact out/TEND_YC_DEMO_FINAL.mp4
