import { continueRender, delayRender, staticFile } from "remotion";

const faces: [string, string, string][] = [
  ["Geist", "fonts/Geist-Regular.woff2", "400"],
  ["Geist", "fonts/Geist-Medium.woff2", "500"],
  ["Geist", "fonts/Geist-SemiBold.woff2", "600"],
  ["Geist Mono", "fonts/GeistMono-Regular.woff2", "400"],
  ["Geist Mono", "fonts/GeistMono-Medium.woff2", "500"],
];

let started = false;
/** Loads the project's brand fonts (Geist, as used by the TEND app) before the first frame is captured. */
export function loadFonts() {
  if (started || typeof document === "undefined") return;
  started = true;
  const handle = delayRender("fonts");
  Promise.all(
    faces.map(([family, file, weight]) => {
      const f = new FontFace(family, `url(${staticFile(file)}) format('woff2')`, { weight });
      document.fonts.add(f);
      return f.load();
    }),
  ).then(() => continueRender(handle), () => continueRender(handle));
}
