import type { Dict } from "./en.ts";

/** A failed request in the reader's language: known server codes are translated, anything else is shown as sent. */
export function errorText(t: Dict, r: { error: string; code?: string; status?: number }) {
  if (r.code === "network") return t.errors.network;
  return (r.code && (t.errors.codes as Record<string, string>)[r.code]) || r.error || t.errors.status(r.status ?? 0);
}
