// The showcase's theme preference. Kept in a cookie (as the app's own display preferences are, ui/prefs.ts) so the server renders the
// chosen theme on the first paint: no flash of the wrong one, and no mismatch when the page hydrates. "system" is resolved in CSS
// (tokens.css, `prefers-color-scheme`), because the server cannot know the visitor's setting. The cookie holds no identity.
export type ThemePref = "light" | "dark" | "system";
export const THEME_COOKIE = "tend-ds-theme";
export const DEFAULT_THEME: ThemePref = "light";

/** A cookie is input like any other: anything unexpected falls back to the default. */
export function parseThemePref(raw: string | null | undefined): ThemePref {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : DEFAULT_THEME;
}
