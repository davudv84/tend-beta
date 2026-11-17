# TEND YC demo (Remotion)

Re-edit of the real TEND + Claude Code screen recording (`source/demo-original.mp4`) into a 53 s, 1080p60 demo.
Not part of the app: it has its own `package.json` and is excluded from the app's typecheck and lint.

- Output: `out/TEND_YC_DEMO_FINAL.mp4`, `out/TEND_YC_DEMO_PREVIEW.mp4`
- What footage is used, what it proves, and the limitations: `out/REPORT.md`
- The edit (segments, camera, highlights, captions, sound cues): `src/timeline.ts`

```bash
npm install
npm run footage     # ffmpeg: split the original into dashboard/terminal plates
npm run audio       # python3 + numpy: synthesize the sound design
npm run studio      # preview/edit in Remotion Studio
REMOTION_CHROME=/path/to/chrome-headless-shell npm run final
npm run preview     # 720p copy of the final
```
