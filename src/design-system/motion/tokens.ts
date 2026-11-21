/**
 * The motion language, in code. Mirrors the CSS custom properties in tokens.css (--t-dur-*, --t-ease-*, --t-move-*), so a
 * CSS transition and a framer-motion animation of the same kind feel identical.
 *
 * Principles
 *  1. Motion explains cause and effect: a thing moves because you did something, from where you did it.
 *  2. Arrivals ease out and are slow enough to read; departures ease in and are about 60% as long.
 *  3. Small distances. UI travels 2 to 12px. Only editorial reveals travel 24px; only stacks travel further.
 *  4. Opacity and position move together; scale never drops below 0.96.
 *  5. Nothing loops except a loading indicator and the single "working" dot.
 *  6. Reduced motion: no travel, no scale, no looping. State changes become instant or a short cross-fade.
 */
export const duration = {
  instant: 0.08,
  fast: 0.14,
  base: 0.22,
  slow: 0.36,
  slower: 0.56,
  cinematic: 0.9,
} as const;

export const ease = {
  out: [0.22, 1, 0.36, 1],
  in: [0.5, 0, 0.9, 0.4],
  inOut: [0.65, 0, 0.35, 1],
} as const;

export const distance = { xs: 2, sm: 6, md: 12, lg: 24, stack: 48 } as const;

/** Springs for things that settle (a layout change, a handoff) rather than start and stop. */
export const spring = {
  settle: { type: "spring", stiffness: 380, damping: 36, mass: 0.9 },
  gentle: { type: "spring", stiffness: 220, damping: 30, mass: 1 },
} as const;

export const stagger = { tight: 0.04, base: 0.07, loose: 0.12 } as const;

/** Ready-made transitions. */
export const transition = {
  hover: { duration: duration.fast, ease: ease.out },
  menu: { duration: duration.base, ease: ease.out },
  tab: { duration: duration.base, ease: ease.out },
  panel: { duration: duration.slow, ease: ease.out },
  reveal: { duration: duration.slower, ease: ease.out },
  page: { duration: duration.slower, ease: ease.out },
  exit: { duration: duration.fast, ease: ease.in },
  stack: { duration: duration.cinematic, ease: ease.out },
} as const;

/** Enter and exit states. `reduced` swaps travel for opacity only. */
export const variants = {
  reveal: {
    hidden: { opacity: 0, y: distance.lg },
    shown: { opacity: 1, y: 0, transition: transition.reveal },
  },
  revealReduced: {
    hidden: { opacity: 0 },
    shown: { opacity: 1, transition: { duration: duration.fast } },
  },
  page: {
    initial: { opacity: 0, y: distance.md },
    animate: { opacity: 1, y: 0, transition: transition.page },
    exit: { opacity: 0, y: -distance.sm, transition: transition.exit },
  },
  pageReduced: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: duration.fast } },
    exit: { opacity: 0, transition: { duration: duration.instant } },
  },
} as const;

/** Reference table used by the showcase. Keep in step with the constants above. */
export const MOTION_TABLE = [
  { name: "Hover", use: "Colour, border, background", duration: "fast · 140ms", ease: "out", travel: "none" },
  { name: "Press", use: "Buttons, rows", duration: "instant · 80ms", ease: "out", travel: "scale 0.985" },
  { name: "Dropdown", use: "Menus, popovers, selects", duration: "base · 220ms", ease: "out", travel: "6px + scale 0.97" },
  { name: "Tooltip", use: "Hints", duration: "fast · 140ms", ease: "out", travel: "6px" },
  { name: "Dialog", use: "Modal, confirmation", duration: "slow · 360ms", ease: "out", travel: "12px + scale 0.985" },
  { name: "Drawer", use: "Side panels", duration: "slow · 360ms", ease: "out", travel: "from edge" },
  { name: "Tab", use: "Indicator and panel", duration: "base · 220ms", ease: "out / settle", travel: "12px" },
  { name: "Toast", use: "Confirmation", duration: "slow · 360ms", ease: "out", travel: "12px" },
  { name: "Reveal", use: "Content entering view", duration: "slower · 560ms", ease: "out", travel: "24px" },
  { name: "Page", use: "Route change", duration: "slower · 560ms", ease: "out", travel: "12px" },
  { name: "Loading", use: "Spinner, skeleton", duration: "700ms · 1.6s", ease: "linear / in-out", travel: "none" },
] as const;
