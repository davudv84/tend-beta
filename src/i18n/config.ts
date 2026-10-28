// Locale settings shared by the server (layout, metadata) and the browser (switcher). No dependencies,
// so it runs under `node --test` too.

export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** The visitor's explicit choice. Without it, the browser's Accept-Language decides. */
export const LOCALE_COOKIE = "tend_lang";
export const LOCALE_MAX_AGE = 60 * 60 * 24 * 365;

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

/** The best supported locale for an Accept-Language header, honouring q-values ("de-CH;q=0.9, en;q=0.8"). */
export function pickLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().toLowerCase().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.trim().slice(2) ?? 1);
      return { lang: tag.split("-")[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return ranked.map((x) => x.lang).find(isLocale) ?? DEFAULT_LOCALE;
}
