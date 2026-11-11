// Which of the homepage's pictures exist under public/home right now. Server only (reads the file system); the page passes
// the result down, and a section whose picture is missing draws its own dusk hills instead, so the page looks finished either way.
import { existsSync } from "node:fs";
import path from "node:path";

export const HOME_IMAGE_FILES = { hero: "hero.jpg", heroForeground: "hero-foreground.png", integrations: "integrations.jpg", footer: "footer.jpg" } as const;
export type HomeImageKey = keyof typeof HOME_IMAGE_FILES;
/** URL paths of the pictures that exist, by key. */
export type HomeImages = Partial<Record<HomeImageKey, string>>;

export function homeImages(): HomeImages {
  const dir = path.join(process.cwd(), "public", "home");
  const out: HomeImages = {};
  for (const key of Object.keys(HOME_IMAGE_FILES) as HomeImageKey[]) {
    const file = HOME_IMAGE_FILES[key];
    if (existsSync(path.join(dir, file))) out[key] = `/home/${file}`;
  }
  return out;
}
