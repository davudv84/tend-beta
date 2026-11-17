/**
 * The whole edit lives here (V3): which slice of the real recording plays when, where the camera looks, and the few
 * words that appear. Times are OUTPUT seconds unless named `src` (seconds in source/demo-original.mp4).
 *
 * Ground rules:
 *  - Every frame of product UI is the original recording. Dashboard and terminal always show the SAME moment of it.
 *  - Segments only cut, trim, or slow down. Where the ORIGINAL was already sped up while waiting for the model,
 *    src/speed.ts discloses it on screen, as the original did.
 */

export const FPS = 30;
export const f = (s: number) => Math.round(s * FPS);

// ---------------------------------------------------------------- frame layout
export const W = 1920;
export const H = 1080;
/** Footage viewport; the strip below it carries the caption line. Same colour as the room, so it only reads as a
 *  strip when the camera is close enough for footage to reach it. */
export const VIEW_H = 980;

// ---------------------------------------------------------------- world geometry
// The original split screen, kept as ONE continuous workspace: dashboard left, terminal right, edge to edge.
export const DASH = { x: 0, y: 0, w: 1280, h: 940 }; // source px 0..1280 x 0..940 (original captions cropped off)
export const TERM_SCALE = 940 / 1080;
export const TERM = { x: DASH.w, y: 0, w: 640 * TERM_SCALE, h: 940 }; // source px 1280..1920 x 0..1080
export const WORLD = { w: TERM.x + TERM.w, h: 940 };

export type Pt = { x: number; y: number };
export const dash = (x: number, y: number): Pt => ({ x: DASH.x + x, y: DASH.y + y });
export const term = (x: number, y: number): Pt => ({ x: TERM.x + x * TERM_SCALE, y: TERM.y + y * TERM_SCALE });

// ---------------------------------------------------------------- footage segments
export type Segment = { start: number; end: number; src: number; rate: number; fadeIn?: number };

export const SEGMENTS: Segment[] = [
  // HOOK — Claude Code is given a command: cat .ssh/demo_decoy.txt (a decoy file)
  { start: 0.0, end: 3.8, src: 27.0, rate: 1 },
  // BLOCK — the PreToolUse hook denies it ("Nothing ran."), then Claude's own account of what happened
  { start: 3.8, end: 7.8, src: 30.8, rate: 1 },
  // …the dashboard: the Blocked row, then the Blocked filter clicked
  { start: 7.8, end: 13.9, src: 35.0, rate: 1 },
  // POLICY — the installer adds Claude Code hooks…
  { start: 13.9, end: 16.7, src: 6.6, rate: 1 },
  // …Balanced rules saved in TEND…
  { start: 16.7, end: 20.0, src: 11.4, rate: 1 },
  // …and a harmless ls, allowed and recorded
  { start: 20.0, end: 22.9, src: 22.0, rate: 1 },
  // APPROVAL — one continuous take: rm waits → card → Allow once → it runs → decision history
  { start: 22.9, end: 36.2, src: 42.6, rate: 1 },
  // VISIBILITY — overview
  { start: 36.2, end: 41.4, src: 59.0, rate: 1 },
];

export const END_START = 40.9;
export const TOTAL = 46.0;
export const TOTAL_FRAMES = f(TOTAL);

export function srcAt(t: number): { src: number; rate: number } | null {
  let hit: Segment | null = null;
  for (const s of SEGMENTS) if (t >= s.start && t < s.end) hit = s;
  if (!hit) return null;
  return { src: hit.src + (t - hit.start) * hit.rate, rate: hit.rate };
}

// ---------------------------------------------------------------- camera
/**
 * Keyframes. `ease` shapes the move INTO this key: "move" (weighted start, long landing), "hold" (a near-still
 * creep), "cut" (jump, used only on a picture cut). `dip` pulls the camera back mid-move by that fraction, so long
 * traverses between panels arc out and back in like an operator re-finding the subject.
 */
export type Cam = { t: number; at: Pt; z: number; ease?: "move" | "hold" | "cut"; dip?: number };

// Terminal "medium": the terminal's right edge at frame right, the dashboard filling the rest; bottom of frame
// sits just under the terminal. No empty room beside the workspace.
// Terminal close-up: the terminal fills the frame width, its last lines just above the caption strip.
const TZ = W / TERM.w; // terminal exactly fills the frame width
const termClose = (z = TZ): Cam["at"] => ({ x: TERM.x + TERM.w / 2, y: WORLD.h + 8 - VIEW_H / 2 / z });
const ZD = 1.96; // dashboard crop: one table or card, edge to edge

export const CAMERA: Cam[] = [
  // hook + block: terminal, one slow push
  { t: 0.0, at: termClose(TZ), z: TZ },
  { t: 7.8, at: termClose(TZ * 1.025), z: TZ * 1.025, ease: "hold" },
  // dashboard: Activity, tabs to rows
  { t: 7.8, at: dash(755, 392), z: ZD, ease: "cut" },
  { t: 13.9, at: dash(755, 384), z: ZD * 1.03, ease: "hold" },
  // installer output
  { t: 13.9, at: termClose(TZ), z: TZ, ease: "cut" },
  { t: 16.7, at: termClose(TZ * 1.018), z: TZ * 1.018, ease: "hold" },
  // rules card, heading to Save
  { t: 16.7, at: dash(640, 690), z: 2.2, ease: "cut" },
  { t: 20.0, at: dash(640, 686), z: 2.25, ease: "hold" },
  // activity: ls allowed
  { t: 20.0, at: dash(756, 470), z: ZD, ease: "cut" },
  { t: 22.9, at: dash(756, 466), z: ZD * 1.02, ease: "hold" },
  // approval take: the request waits in the terminal…
  { t: 22.9, at: termClose(TZ), z: TZ, ease: "cut" },
  { t: 26.1, at: termClose(TZ * 1.009), z: TZ * 1.009, ease: "hold" },
  // …the card in TEND, through the click…
  { t: 27.1, at: dash(756, 478), z: ZD, ease: "move", dip: 0.45 },
  { t: 30.4, at: dash(756, 482), z: ZD * 1.02, ease: "hold" },
  // …back to the terminal: it runs…
  { t: 31.4, at: termClose(TZ), z: TZ, ease: "move", dip: 0.45 },
  { t: 34.0, at: termClose(TZ * 1.009), z: TZ * 1.009, ease: "hold" },
  // …and the decision history
  { t: 35.0, at: dash(756, 568), z: ZD, ease: "move", dip: 0.45 },
  { t: 36.2, at: dash(756, 568), z: ZD, ease: "hold" },
  // overview: counters and agents
  { t: 36.2, at: dash(756, 352), z: ZD, ease: "cut" },
  { t: 41.4, at: dash(756, 340), z: ZD * 1.04, ease: "hold" },
];

// ---------------------------------------------------------------- which panel has the viewer's attention
export type Focus = "term" | "dash" | "both";
export const FOCUS: { t: number; focus: Focus }[] = [
  { t: 0, focus: "term" },
  { t: 7.8, focus: "dash" },
  { t: 13.9, focus: "term" },
  { t: 16.7, focus: "dash" },
  { t: 22.9, focus: "term" },
  { t: 26.4, focus: "dash" },
  { t: 30.6, focus: "term" },
  { t: 34.2, focus: "dash" },
];

// ---------------------------------------------------------------- emphasis (rare; a soft contrast change, no outline)
export type Spot = { start: number; end: number; plate: "dash" | "term"; x: number; y: number; w: number; h: number; dim?: number };
export const SPOTS: Spot[] = [];

// ---------------------------------------------------------------- captions: few, short, only where the UI needs help
export type Caption = { start: number; end: number; text: string };
export const CAPTIONS: Caption[] = [
  { start: 0.15, end: 1.95, text: "AI agents can execute commands." },
  { start: 2.0, end: 3.75, text: "Who controls what they’re allowed to do?" },
  { start: 4.0, end: 13.7, text: "Blocked before execution." },
  { start: 14.1, end: 22.7, text: "Define rules. Enforce them automatically." },
  { start: 23.1, end: 33.9, text: "Sensitive actions require approval." },
  { start: 34.2, end: 40.7, text: "Every decision recorded." },
];

// ---------------------------------------------------------------- sound cues (output seconds)
export const CUES = {
  block: 3.8,
  approved: 22.9 + (50.0 - 42.6),
  end: 41.6,
};
