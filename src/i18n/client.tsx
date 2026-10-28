"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { setFormatLocale } from "@/lib/format";
import { isLocale, LOCALE_COOKIE, LOCALE_MAX_AGE, type Locale } from "./config";
import { DICTS, type Dict } from "./index";

const I18n = createContext<{ locale: Locale; t: Dict; setLocale: (l: Locale) => void } | null>(null);

/** Holds the interface language. The server picks the first one (cookie, else Accept-Language) so the page renders in it. */
export function I18nProvider({ locale: initial, children }: { locale: Locale; children: React.ReactNode }) {
  const router = useRouter();
  const [locale, setState] = useState(initial);
  // The server's choice wins when it changes (a refresh after the cookie changed).
  const [served, setServed] = useState(initial);
  if (initial !== served) {
    setServed(initial);
    setState(initial);
    setFormatLocale(initial);
  }

  const apply = useCallback((l: Locale) => {
    document.documentElement.lang = l;
    setFormatLocale(l);
    setState(l);
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

  const value = useMemo(() => ({ locale, t: DICTS[locale], setLocale }), [locale, setLocale]);
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
