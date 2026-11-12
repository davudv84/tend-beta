"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { setFormatDict, setFormatLocale } from "@/lib/format";
import { isLocale, LOCALE_COOKIE, LOCALE_MAX_AGE, type Locale } from "./config";
import type { Dict } from "./en";

/** The other language's dictionary, fetched only when someone switches to it. */
const load = (l: Locale): Promise<Dict> => (l === "de" ? import("./de").then((m) => m.de) : import("./en").then((m) => m.en));

const I18n = createContext<{ locale: Locale; t: Dict; setLocale: (l: Locale) => void } | null>(null);

/** Holds the interface language. The server picks the first one (cookie, else Accept-Language) so the page renders in it. */
/**
 * `dict` is the dictionary of `locale`, passed in by the small provider for that language (provide-en.tsx, provide-de.tsx), so the page
 * ships one language. Switching loads the other one and swaps it in place.
 */
export function I18nProvider({ locale: initial, dict: initialDict, children }: { locale: Locale; dict: Dict; children: React.ReactNode }) {
  const router = useRouter();
  const [{ locale, t }, setState] = useState({ locale: initial, t: initialDict });
  // The server's choice wins when it changes (a refresh after the cookie changed).
  const [served, setServed] = useState(initial);
  if (initial !== served) {
    setServed(initial);
    setState({ locale: initial, t: initialDict });
  }
  // The formatter needs the dictionary before anything below renders a time.
  setFormatDict(t, locale);

  const apply = useCallback((l: Locale) => {
    document.documentElement.lang = l;
    setFormatLocale(l);
    void load(l).then((d) => setState({ locale: l, t: d }));
  }, []);

  const setLocale = useCallback((l: Locale) => {
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=${LOCALE_MAX_AGE}; samesite=lax${secure}`;
    apply(l);
    // Server-rendered text (the landing page, page titles) follows on refresh; client state is kept.
    router.refresh();
  }, [apply, router]);

  // Another tab may have switched the language; follow it when this one is looked at again.
  useEffect(() => {
    const follow = () => {
      const saved = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=(\\w+)`))?.[1];
      if (document.hidden || !isLocale(saved) || saved === locale) return;
      apply(saved);
      router.refresh();
    };
    document.addEventListener("visibilitychange", follow);
    return () => document.removeEventListener("visibilitychange", follow);
  }, [locale, apply, router]);

  const value = useMemo(() => ({ locale, t, setLocale }), [locale, t, setLocale]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

function useI18n() {
  const v = useContext(I18n);
  if (!v) throw new Error("useT must be used inside I18nProvider");
  return v;
}

/** The dictionary for the current interface language. */
export const useT = () => useI18n().t;
export const useLocale = () => {
  const { locale, setLocale } = useI18n();
  return { locale, setLocale };
};
