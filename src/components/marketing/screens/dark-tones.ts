import type { Tone } from "@/ui/primitives";

/**
 * Badge colours for a dark screen, as `dark:` classes to pass to the app's Badge. The app's Badge keeps its light tints in dark
 * (ui/primitives.tsx); on the homepage the same word and mark sit on tints made for the dark surface, so a status reads as quietly
 * as it does on a light one. They apply inside an element with the `dark` class (AppShell sets it).
 */
export const DARK_TONE: Record<Tone, string> = {
  good: "dark:bg-[rgb(141_187_165/0.14)] dark:text-[#a6cbb8]",
  attention: "dark:bg-[rgb(217_165_91/0.14)] dark:text-[#e4ba7a]",
  danger: "dark:bg-[rgb(217_128_106/0.15)] dark:text-[#eba491]",
  neutral: "dark:bg-[rgb(237_232_222/0.07)] dark:text-[#d2cbbe]",
};
