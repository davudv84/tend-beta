import type { Locale } from "./config.ts";
import { de } from "./de.ts";
import { en, type Dict } from "./en.ts";

export type { Dict, LogArgs } from "./en.ts";
export const DICTS: Record<Locale, Dict> = { en, de };

// Kept in its own module so a browser bundle that only needs errorText doesn't pull in both dictionaries.
export { errorText } from "./error-text.ts";
