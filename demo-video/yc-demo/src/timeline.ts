/**
 * The whole edit lives here (V3): which slice of the real recording plays when, where the camera looks, and the few
 * words that appear. Times are OUTPUT seconds unless named `src` (seconds in source/demo-original.mp4).
 *
 * Ground rules:
 *  - Every frame of product UI is the original recording. Dashboard and terminal always show the SAME moment of it.
 *  - Segments only cut, trim, or slow down. Where the ORIGINAL was already sped up while waiting for the model,
 *    src/speed.ts discloses it on screen, as the original did.
 */

export const FPS = 60;
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
  // THE BLOCK — Claude Code tries `cat .ssh/demo_decoy.txt` (a decoy file); TEND's PreToolUse hook denies it.
  { start: 0.0, end: 1.9, src: 28.9, rate: 1 },
  // terminal is static until Claude replies: held slower so the denial can be read
  { start: 1.9, end: 6.0, src: 30.8, rate: (32.2 - 30.8) / 4.1 },
  // same moment, wider: the dashboard already lists it…
  { start: 6.0, end: 7.8, src: 32.2, rate: 1 },
  // …then the Blocked filter, seconds later
  { start: 7.8, end: 11.4, src: 37.3, rate: 1, fadeIn: 0.3 },
  // POLICY — earlier in the same recording: the installer's output…
  { start: 11.4, end: 14.8, src: 6.4, rate: 1, fadeIn: 0.35 },
  // …the rules chosen and saved in TEND…
  { start: 14.8, end: 18.6, src: 11.2, rate: 1, fadeIn: 0.35 },
  // …and a harmless `ls`, which simply runs and is recorded
  { start: 18.6, end: 22.0, src: 21.4, rate: 1, fadeIn: 0.35 },
  // APPROVAL — one continuous take: rm waits → Allow once → it runs → decision history
  { start: 22.0, end: 36.0, src: 42.5, rate: 1, fadeIn: 0.35 },
  // OVERVIEW
  { start: 36.0, end: 41.2, src: 58.8, rate: 1, fadeIn: 0.35 },
];

export const END_START = 40.6;
export const TOTAL = 45.0;
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

const WIDE: Cam["at"] = { x: WORLD.w / 2, y: WORLD.h / 2 };
const ZW = Math.min((W * 0.985) / WORLD.w, (VIEW_H * 0.975) / WORLD.h);
// Terminal "medium": the terminal's right edge at frame right, the dashboard filling the rest; bottom of frame
// sits just under the terminal. No empty room beside the workspace.
const termMed = (z: number, lift = 12): Cam["at"] => ({ x: WORLD.w + 6 - W / 2 / z, y: WORLD.h + lift - VIEW_H / 2 / z });

export const CAMERA: Cam[] = [
  // the block: medium on the terminal, one slow push as the denial lands
  { t: 0.0, at: termMed(2.15), z: 2.15 },
  { t: 6.0, at: termMed(2.42), z: 2.42, ease: "hold" },
  // pull back to the whole workspace: the dashboard has it too
  { t: 7.5, at: WIDE, z: ZW, ease: "move" },
  // into the Activity log, title to blocked row
  { t: 9.3, at: dash(760, 318), z: 1.6, ease: "move" },
  { t: 11.3, at: dash(760, 322), z: 1.64, ease: "hold" },
  // across to the installer output
  { t: 12.8, at: termMed(2.1), z: 2.1, ease: "move", dip: 0.32 },
  { t: 14.7, at: termMed(2.16), z: 2.16, ease: "hold" },
  // back to the rules, whole card with the sidebar for context
  { t: 16.1, at: dash(640, 632), z: 1.55, ease: "move", dip: 0.28 },
  { t: 18.5, at: dash(640, 628), z: 1.58, ease: "hold" },
  // both panels for the harmless command
  { t: 19.9, at: { x: 1000, y: 498 }, z: 1.08, ease: "move" },
  { t: 22.0, at: { x: 1004, y: 498 }, z: 1.09, ease: "hold" },
  // approval: the request in the terminal…
  { t: 23.3, at: termMed(2.25), z: 2.25, ease: "move" },
  { t: 25.2, at: termMed(2.3), z: 2.3, ease: "hold" },
  // …the card in TEND, whole, buttons in shot; hold through the click
  { t: 26.9, at: dash(756, 468), z: 1.8, ease: "move", dip: 0.3 },
  { t: 29.6, at: dash(756, 472), z: 1.83, ease: "hold" },
  // …back to the terminal: it ran
  { t: 31.2, at: termMed(2.2), z: 2.2, ease: "move", dip: 0.3 },
  { t: 33.4, at: termMed(2.25), z: 2.25, ease: "hold" },
  // …and the decision history
  { t: 34.8, at: dash(756, 560), z: 1.7, ease: "move", dip: 0.28 },
  { t: 36.0, at: dash(756, 560), z: 1.7, ease: "hold" },
  // overview (picture cut): the whole page, settling toward the counters
  { t: 36.0, at: dash(756, 470), z: 1.45, ease: "cut" },
  { t: 41.2, at: dash(756, 420), z: 1.55, ease: "hold" },
];

// ---------------------------------------------------------------- which panel has the viewer's attention
export type Focus = "term" | "dash" | "both";
export const FOCUS: { t: number; focus: Focus }[] = [
  { t: 0, focus: "term" },
  { t: 6.2, focus: "both" },
  { t: 8.2, focus: "dash" },
  { t: 11.6, focus: "term" },
  { t: 15.0, focus: "dash" },
  { t: 18.8, focus: "both" },
  { t: 22.2, focus: "term" },
  { t: 25.8, focus: "dash" },
  { t: 30.0, focus: "term" },
  { t: 33.6, focus: "dash" },
];

// ---------------------------------------------------------------- emphasis (rare; a soft contrast change, no outline)
export type Spot = { start: number; end: number; plate: "dash" | "term"; x: number; y: number; w: number; h: number; dim?: number };
export const SPOTS: Spot[] = [
  // the denial line itself
  { start: 2.3, end: 6.1, plate: "term", x: 4, y: 978, w: 632, h: 50, dim: 0.5 },
];

// ---------------------------------------------------------------- captions: few, short, only where the UI needs help
export type Caption = { start: number; end: number; text: string };
export const CAPTIONS: Caption[] = [
  { start: 2.6, end: 5.9, text: "Blocked before execution" },
  { start: 8.6, end: 11.2, text: "Logged with the rule that stopped it" },
  { start: 12.4, end: 14.6, text: "Every tool call checked by TEND" },
  { start: 15.7, end: 18.4, text: "Rules live in TEND, not the agent" },
  { start: 19.6, end: 21.8, text: "Harmless commands just run" },
  { start: 24.6, end: 29.2, text: "Human approval required" },
  { start: 31.6, end: 34.4, text: "Allowed once, then executed" },
  { start: 36.6, end: 40.3, text: "Every decision recorded" },
];

// ---------------------------------------------------------------- sound cues (output seconds)
export const CUES = {
  block: 1.9,
  approved: 22.0 + (50.0 - 42.5),
  end: 41.3,
};
