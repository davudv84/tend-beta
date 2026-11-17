/**
 * The whole edit lives here: which slice of the real recording plays when, where the camera looks, and what the
 * captions say. Times are OUTPUT seconds unless named `src` (seconds in source/demo-original.mp4).
 *
 * Ground rules this file follows:
 *  - Every frame of product UI is the original recording. Both panels (dashboard + terminal) always show the SAME
 *    moment of it, so cause and effect stay real.
 *  - Segments only cut, trim, or slow down. Where the ORIGINAL was already sped up while waiting for the model,
 *    src/speed.ts shows that on screen ("2x · waiting for the model"), exactly as the original did.
 */

export const FPS = 60;
export const f = (s: number) => Math.round(s * FPS);

// ---------------------------------------------------------------- world geometry
// The "world" is the original split screen pulled apart: dashboard plate on the left, terminal plate on the right.
export const DASH = { x: 0, y: 0, w: 1280, h: 940 }; // source px 0..1280 x 0..940 (captions of the original cropped off)
export const TERM_SCALE = 940 / 1080;
export const GAP = 36;
export const TERM = { x: DASH.w + GAP, y: 0, w: 640 * TERM_SCALE, h: 940 }; // source px 1280..1920 x 0..1080
export const WORLD = { w: TERM.x + TERM.w, h: 940 };

export type Pt = { x: number; y: number };
/** Dashboard source pixel -> world. */
export const dash = (x: number, y: number): Pt => ({ x: DASH.x + x, y: DASH.y + y });
/** Terminal source pixel (0..640, 0..1080) -> world. */
export const term = (x: number, y: number): Pt => ({ x: TERM.x + x * TERM_SCALE, y: TERM.y + y * TERM_SCALE });

// ---------------------------------------------------------------- footage segments
export type Segment = {
  start: number; // output s
  end: number; // output s
  src: number; // source s at `start`
  rate: number; // source seconds per output second
  fadeIn?: number; // crossfade from the previous segment, output s
};

export const SEGMENTS: Segment[] = [
  // SCENE 1 — THE BLOCK. Claude Code is asked to cat a decoy SSH key file; TEND's PreToolUse hook denies it.
  { start: 0.0, end: 2.2, src: 28.6, rate: 1 },
  // Nothing changes on screen here (terminal is idle until Claude's reply): held at a slower rate for reading.
  { start: 2.2, end: 5.4, src: 30.8, rate: 0.4375 },
  // SCENE 2 — WHAT JUST HAPPENED. The same moment, continuing: the dashboard already lists the blocked call.
  { start: 5.4, end: 7.5, src: 32.2, rate: 1 },
  // ...the Blocked filter, a few seconds later in the recording.
  { start: 7.5, end: 11.1, src: 37.3, rate: 1, fadeIn: 0.25 },
  // SCENE 3 — THE SECURITY LAYER. Earlier in the same recording: the real installer run…
  { start: 11.1, end: 16.1, src: 5.3, rate: 1, fadeIn: 0.3 },
  // …the rules chosen in TEND (Balanced) and saved…
  { start: 16.1, end: 20.6, src: 10.6, rate: 1, fadeIn: 0.3 },
  // …and a harmless `ls`, which runs and is recorded.
  { start: 20.6, end: 25.0, src: 20.6, rate: 1, fadeIn: 0.3 },
  // SCENE 4 — HUMAN APPROVAL. `rm scratch/old-report.txt` waits for a person; Allow once; it runs. One continuous take.
  { start: 25.0, end: 39.6, src: 42.5, rate: 1, fadeIn: 0.3 },
  // SCENE 5 — COMPLETE VISIBILITY. The Overview right after.
  { start: 39.6, end: 44.9, src: 58.8, rate: 1, fadeIn: 0.3 },
];

export const FOOTAGE_END = 44.9;
export const END_START = 44.3; // end card fades in over the last footage
export const TOTAL = 53.0;
export const TOTAL_FRAMES = f(TOTAL);

/** Source time shown at output time t (for the speed disclosure and for debugging). */
export function srcAt(t: number): { src: number; rate: number } | null {
  let hit: Segment | null = null;
  for (const s of SEGMENTS) if (t >= s.start && t < s.end) hit = s;
  if (!hit) return null;
  return { src: hit.src + (t - hit.start) * hit.rate, rate: hit.rate };
}

// ---------------------------------------------------------------- camera
export type Cam = { t: number; at: Pt; z: number; ease?: "move" | "drift" | "settle" };
const WIDE: Pt = { x: WORLD.w / 2, y: WORLD.h / 2 };
const ZW = 0.925; // wide: the whole split screen

export const CAMERA: Cam[] = [
  // 1 — open tight on the terminal prompt, creep toward the denial
  { t: 0.0, at: term(322, 948), z: 2.42 },
  { t: 2.2, at: term(322, 962), z: 2.55, ease: "drift" },
  { t: 5.2, at: term(322, 985), z: 2.78, ease: "drift" },
  // 2 — pull back to reveal the dashboard, then travel to the blocked row
  { t: 6.55, at: WIDE, z: ZW },
  { t: 7.3, at: { x: WIDE.x - 20, y: WIDE.y }, z: ZW * 1.02, ease: "drift" },
  { t: 8.5, at: dash(756, 420), z: 1.66 },
  { t: 11.0, at: dash(756, 418), z: 1.76, ease: "drift" },
  // 3 — out and across to the installer output in the terminal
  { t: 11.75, at: { x: 1250, y: 560 }, z: 1.12 },
  { t: 12.7, at: term(322, 870), z: 2.38, ease: "settle" },
  { t: 15.9, at: term(322, 876), z: 2.52, ease: "drift" },
  //   …across to the rules in the dashboard
  { t: 16.75, at: dash(1000, 640), z: 1.25 },
  { t: 17.6, at: dash(630, 668), z: 1.92, ease: "settle" },
  { t: 20.4, at: dash(630, 662), z: 2.0, ease: "drift" },
  //   …and out to both panels for the harmless command
  { t: 21.5, at: { x: WIDE.x, y: 520 }, z: 1.02 },
  { t: 24.8, at: { x: WIDE.x + 10, y: 520 }, z: 1.07, ease: "drift" },
  // 4 — the delete request in the terminal…
  { t: 25.9, at: term(322, 968), z: 2.3, ease: "settle" },
  { t: 29.0, at: term(322, 976), z: 2.42, ease: "drift" },
  //   …the approval card in TEND, then the person's click…
  { t: 30.0, at: dash(756, 505), z: 1.72 },
  { t: 31.0, at: dash(640, 548), z: 1.92, ease: "drift" },
  { t: 31.9, at: dash(560, 575), z: 2.15, ease: "settle" },
  //   …both sides as the decision lands…
  { t: 33.3, at: { x: WIDE.x, y: 560 }, z: 1.0 },
  { t: 35.0, at: { x: WIDE.x + 20, y: 580 }, z: 1.04, ease: "drift" },
  //   …the terminal: it actually ran…
  { t: 35.9, at: term(322, 952), z: 2.25 },
  { t: 37.1, at: term(322, 958), z: 2.33, ease: "drift" },
  //   …and the record of it
  { t: 38.0, at: dash(756, 560), z: 1.58 },
  { t: 39.5, at: dash(756, 556), z: 1.64, ease: "drift" },
  // 5 — overview: wide, then the counters, then the record
  { t: 40.3, at: WIDE, z: ZW, ease: "settle" },
  { t: 41.4, at: dash(756, 262), z: 1.62 },
  { t: 42.6, at: dash(756, 270), z: 1.66, ease: "drift" },
  { t: 44.0, at: dash(756, 640), z: 1.42 },
  { t: 45.4, at: dash(756, 660), z: 1.32, ease: "drift" },
];

// ---------------------------------------------------------------- which panel has the viewer's attention
export type Focus = "term" | "dash" | "both";
export const FOCUS: { t: number; focus: Focus }[] = [
  { t: 0, focus: "term" },
  { t: 5.6, focus: "both" },
  { t: 7.1, focus: "dash" },
  { t: 10.75, focus: "term" },
  { t: 16.1, focus: "dash" },
  { t: 20.6, focus: "both" },
  { t: 25.0, focus: "term" },
  { t: 29.3, focus: "dash" },
  { t: 32.9, focus: "both" },
  { t: 35.4, focus: "term" },
  { t: 37.5, focus: "dash" },
];

// ---------------------------------------------------------------- focus highlights (real UI, framed — never altered)
export type Spot = {
  start: number;
  end: number;
  plate: "dash" | "term";
  // plate source px
  x: number;
  y: number;
  w: number;
  h: number;
  tone: "blocked" | "approved" | "accent" | "waiting";
  dim?: number; // how much the rest of the plate dims
};

export const SPOTS: Spot[] = [
  { start: 2.35, end: 5.35, plate: "term", x: 12, y: 982, w: 616, h: 42, tone: "blocked", dim: 0.5 },
  { start: 8.6, end: 11.0, plate: "dash", x: 286, y: 392, w: 942, h: 58, tone: "blocked" },
  { start: 13.0, end: 16.0, plate: "term", x: 12, y: 834, w: 616, h: 84, tone: "accent" },
  { start: 17.7, end: 20.5, plate: "dash", x: 312, y: 550, w: 652, h: 98, tone: "accent" },
  { start: 22.2, end: 24.9, plate: "dash", x: 286, y: 534, w: 942, h: 56, tone: "approved", dim: 0.35 },
  { start: 28.6, end: 29.9, plate: "term", x: 12, y: 1002, w: 616, h: 28, tone: "waiting", dim: 0.45 },
  { start: 30.1, end: 31.7, plate: "dash", x: 282, y: 296, w: 950, h: 412, tone: "accent", dim: 0.3 },
  { start: 33.7, end: 35.3, plate: "dash", x: 286, y: 500, w: 942, h: 62, tone: "approved", dim: 0.35 },
  { start: 35.9, end: 37.5, plate: "term", x: 12, y: 905, w: 616, h: 32, tone: "approved", dim: 0.45 },
  { start: 38.1, end: 39.5, plate: "dash", x: 286, y: 510, w: 942, h: 64, tone: "approved", dim: 0.35 },
  { start: 41.5, end: 42.9, plate: "dash", x: 760, y: 206, w: 474, h: 114, tone: "accent", dim: 0.3 },
];

// ---------------------------------------------------------------- captions (one statement at a time)
export type Caption = {
  start: number;
  end: number;
  kicker?: string;
  text: string;
  /** substring of `text` to color */
  em?: { word: string; tone: "blocked" | "approved" | "accent" | "waiting" };
  sub?: string;
};

export const CAPTIONS: Caption[] = [
  { start: 0.35, end: 2.15, kicker: "Claude Code · real session", text: "Claude Code is asked to read an SSH key file." },
  { start: 2.4, end: 5.3, kicker: "Claude Code · real session", text: "TEND blocked it. Nothing ran.", em: { word: "blocked", tone: "blocked" } },
  {
    start: 7.0,
    end: 11.0,
    kicker: "TEND · Activity",
    text: "Blocked before execution.",
    em: { word: "Blocked", tone: "blocked" },
    sub: "Logged, with the rule that stopped it.",
  },
  {
    start: 11.9,
    end: 16.0,
    kicker: "Setup · real installer output",
    text: "One command connects Claude Code to TEND.",
    sub: "Its hooks ask TEND before every tool call runs.",
  },
  {
    start: 16.9,
    end: 20.5,
    kicker: "TEND · Rules",
    text: "The rules live in TEND, outside the agent.",
    em: { word: "in TEND", tone: "accent" },
    sub: "Balanced: deletes, publishing, sudo and network access wait for a person.",
  },
  {
    start: 21.3,
    end: 24.9,
    kicker: "Claude Code + TEND",
    text: "Harmless commands run, and every one is recorded.",
    em: { word: "run", tone: "approved" },
  },
  { start: 25.6, end: 29.0, kicker: "Human approval", text: "Deleting a file needs a person's OK.", em: { word: "a person's OK", tone: "waiting" } },
  { start: 29.3, end: 32.4, kicker: "TEND · Approvals", text: "Claude Code waits. You decide in TEND.", em: { word: "You decide", tone: "accent" } },
  {
    start: 32.8,
    end: 39.4,
    kicker: "Claude Code + TEND",
    text: "Allowed once. It ran, and the decision is on record.",
    em: { word: "Allowed once.", tone: "approved" },
  },
  { start: 40.2, end: 44.6, kicker: "TEND · Overview", text: "Every action, decision and reason. One place." },
];

// ---------------------------------------------------------------- sound cues (output seconds)
export const CUES = {
  block: 2.2,
  rowReveal: 8.6,
  approveClick: 25.0 + (49.55 - 42.5),
  ran: 25.0 + (52.5 - 42.5),
  end: 46.4,
};
