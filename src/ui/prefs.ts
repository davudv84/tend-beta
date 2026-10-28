// The person's own display preferences for the redesigned screens. They change how things look and how much is expanded,
// never what can be done or what information is available. Pure helpers only (no React), so the server layout can use them;
// the provider and hook are in prefs-context.tsx.
//
// Kept in a cookie (not only in the browser's storage) so the server can render the right theme and the right amount of detail
// on the very first paint, with no flash of the wrong one. It holds no identity and nothing sensitive.
export type ThemePref = "system" | "light" | "dark";
export interface UiPrefs {
  theme: ThemePref;
  /** Open every "Details" by default. Security-critical information is shown either way; this only expands the rest. */
  details: boolean;
}

export const PREFS_COOKIE = "tend-ui";
export const DEFAULT_PREFS: UiPrefs = { theme: "light", details: false };
const THEMES: ThemePref[] = ["system", "light", "dark"];

/** Anything unexpected falls back to the defaults: a cookie is input like any other. */
export function parsePrefs(raw: string | null | undefined): UiPrefs {
  try {
    const o = raw ? JSON.parse(raw) : {};
    return { theme: THEMES.includes(o?.theme) ? o.theme : DEFAULT_PREFS.theme, details: o?.details === true };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** From the raw cookie value, which is URL-encoded JSON. */
export function prefsFromCookie(value: string | undefined): UiPrefs {
  try {
    return parsePrefs(value ? decodeURIComponent(value) : null);
  } catch {
    return DEFAULT_PREFS;
  }
}
