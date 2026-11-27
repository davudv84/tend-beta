import SCREENS from "../screens.json";

/**
 * Real screenshots of TEND for the homepage, always in the app's dark theme (the page is dark), and the arithmetic that crops one to
 * the part that matters. Used by the 3D passage and by the sections after it.
 */
export type ScreenName = keyof typeof SCREENS;
/** A box in % of a screenshot: x, y, width, height. */
export type Box = readonly [x: number, y: number, w: number, h: number];
/** A crop: where it starts and how wide it is, in % of the screenshot. Its height follows from the frame's shape. */
export type Crop = readonly [x: number, y: number, w: number];

export function darkSet(name: ScreenName) {
  const s = SCREENS[name];
  return {
    avif: s.widths.map((w) => `/screens/${name}-dark-${w}.avif ${w}w`).join(", "),
    webp: s.widths.map((w) => `/screens/${name}-dark-${w}.webp ${w}w`).join(", "),
    src: `/screens/${name}-dark-${s.widths[Math.min(3, s.widths.length - 1)]}.webp`,
    w: s.w,
    h: s.h,
  };
}

const pc = (v: number) => `${Math.round(v * 100) / 100}%`;

/**
 * Where the screenshot goes so that `crop` fills a frame of the given aspect (width / height), and where a box on the screenshot then
 * lands, both in % of the frame. Returns [left, top, width, height] strings.
 */
export function place(name: ScreenName, [cx, cy, cw]: Crop, aspect: number, [fx, fy, fw, fh]: Box = [0, 0, 0, 0]) {
  const s = SCREENS[name];
  const ch = (cw * s.w) / (s.h * aspect);
  return {
    img: [pc((-cx / cw) * 100), pc((-cy / ch) * 100), pc(10000 / cw), pc(10000 / ch)],
    box: [pc(((fx - cx) / cw) * 100), pc(((fy - cy) / ch) * 100), pc((fw / cw) * 100), pc((fh / ch) * 100)],
  };
}

/** The four box values as CSS variables with a prefix (--l, --t, --w, --h; --ml…), for a stylesheet to pick per breakpoint. */
export const boxVars = (prefix: string, [l, t, w, h]: string[]) => ({ [`--${prefix}l`]: l, [`--${prefix}t`]: t, [`--${prefix}w`]: w, [`--${prefix}h`]: h });
