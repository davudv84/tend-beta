import { useSyncExternalStore } from "react";
import type { Locale } from "../i18n/config.ts";
import type { Dict } from "../i18n/en.ts";

// Times and dates in the interface language. The server renders no times (they need the store), so the
// browser's <html lang>, set by the server and updated by the language switch, is the source of truth.
let locale: Locale = typeof document !== "undefined" && document.documentElement.lang === "de" ? "de" : "en";
export const setFormatLocale = (l: Locale) => void (locale = l);
// The dictionary of the current language, handed in by the language provider (i18n/client.tsx) before anything below it renders,
// so a browser bundle carries only the language it shows. Times are never rendered on the server.
let dict: Dict | null = null;
export const setFormatDict = (d: Dict, l: Locale) => { dict = d; locale = l; };
const t = (): Dict => {
  if (!dict) throw new Error(`format: no dictionary for "${locale}" yet; render inside the language provider`);
  return dict;
};

function elapsed(at: number, now: number): [number, "m" | "h" | "d"] | null {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return null;
  const m = Math.round(s / 60);
  if (m < 60) return [m, "m"];
  const h = Math.round(m / 60);
  return h < 24 ? [h, "h"] : [Math.round(h / 24), "d"];
}

export function timeAgo(at: number, now: number) {
  const e = elapsed(at, now);
  return e ? t().time.ago(...e) : t().time.justNow;
}

/** How long something has been running: "12m", "12 Min.". */
export function duration(at: number, now: number) {
  return t().time.span(...(elapsed(at, now) ?? [1, "m"]));
}

export const clock = (at: number) => new Date(at).toLocaleTimeString(t().intl.time, { hour: "2-digit", minute: "2-digit" });

export const shortDate = (at: number) => new Date(at).toLocaleDateString(t().intl.date, { month: "short", day: "numeric" });

export const dateTime = (at: number) =>
  new Date(at).toLocaleString(t().intl.date, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export function dayLabel(at: number, now: number) {
  const a = new Date(at).toDateString();
  if (a === new Date(now).toDateString()) return t().time.today;
  if (a === new Date(now - 86_400_000).toDateString()) return t().time.yesterday;
  return new Date(at).toLocaleDateString(t().intl.date, { weekday: "long", month: "short", day: "numeric" });
}

// One shared clock for relative times. The server snapshot is 0: time-dependent UI renders only in the browser.
let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer) {
    current = Date.now(); // the clock may have been idle; React re-reads the snapshot after subscribing
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((l) => l());
    }, 15_000);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size) timer = (clearInterval(timer), undefined);
  };
}

/** Current time, refreshed every 15 seconds. */
export function useNow() {
  return useSyncExternalStore(subscribe, () => current || (current = Date.now()), () => 0);
}

/** The Study, with one tool call's record open. */
export const eventHref = (id: string) => `/sanctuary?place=study&inspect=event:${id}`;
