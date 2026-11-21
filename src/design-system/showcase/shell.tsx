"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Menu, Monitor, Moon, Sun } from "lucide-react";
import { cx } from "../cx";
import { Scope, useReducedMotionPref, type ThemeName } from "../scope";
import { spring } from "../motion/tokens";
import { IconButton } from "../ui/button";
import { Icon } from "../ui/icons";
import { Wordmark } from "../ui/navigation";
import { ToastProvider } from "../ui/feedback";
import { TooltipProvider } from "../ui/tooltip";
import { Drawer, DrawerContent, DrawerTrigger } from "../ui/overlays";
import { Switch } from "../ui/forms";

export const CHAPTERS = [
  { id: "overview", label: "Overview" },
  { id: "brand", label: "Brand" },
  { id: "colors", label: "Colour" },
  { id: "typography", label: "Typography" },
  { id: "spacing", label: "Spacing and layout" },
  { id: "surfaces", label: "Surfaces" },
  { id: "buttons", label: "Buttons" },
  { id: "forms", label: "Form controls" },
  { id: "navigation", label: "Navigation" },
  { id: "data", label: "Feedback and data" },
  { id: "tend", label: "TEND components" },
  { id: "motion", label: "Motion" },
  { id: "themes", label: "Light and dark" },
  { id: "compositions", label: "Compositions" },
] as const;

type Pref = "light" | "dark" | "system";
const STORE = "tend-ds-theme";

/* The theme preference lives in localStorage and the system setting in matchMedia; both are external stores. */
const prefListeners = new Set<() => void>();
const subscribePref = (cb: () => void) => { prefListeners.add(cb); return () => { prefListeners.delete(cb); }; };
function readPref(): Pref {
  try {
    const v = localStorage.getItem(STORE);
    return v === "light" || v === "dark" || v === "system" ? v : "light";
  } catch {
    return "light";
  }
}
function writePref(p: Pref) {
  try { localStorage.setItem(STORE, p); } catch {}
  prefListeners.forEach((l) => l());
}
const subscribeSystem = (cb: () => void) => {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const readSystem = (): ThemeName => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

function useScrollSpy(ids: readonly string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const seen = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        // The chapter that fills the most of the reading band wins; ties go to the earlier one.
        let best = ids[0];
        let top = -1;
        for (const id of ids) {
          const r = seen.get(id) ?? 0;
          if (r > top) { top = r; best = id; }
        }
        if (top > 0) setActive(best);
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.01, 0.1, 0.3, 0.6, 1] },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [ids]);
  return [active, setActive] as const;
}

function ThemeSwitch({ pref, onChange }: { pref: Pref; onChange: (p: Pref) => void }) {
  const reduced = useReducedMotionPref();
  const opts: { v: Pref; label: string; icon: typeof Sun }[] = [
    { v: "light", label: "Light", icon: Sun },
    { v: "dark", label: "Dark", icon: Moon },
    { v: "system", label: "System", icon: Monitor },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="relative flex h-9 items-center rounded-t-md bg-t-sunken p-0.5">
      {opts.map((o) => {
        const on = pref === o.v;
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.v)}
            className={cx(
              "relative flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-t-label transition-colors duration-(--t-dur-fast) ease-t-out",
              on ? "text-t-ink" : "text-t-muted hover:text-t-ink",
            )}
          >
            {on && (
              <motion.span
                layoutId="theme-pill"
                aria-hidden
                className="absolute inset-0 rounded-[6px] border border-t-line bg-t-raised shadow-t-1"
                transition={reduced ? { duration: 0 } : spring.settle}
              />
            )}
            <Icon icon={o.icon} size="md" className="relative" />
            <span className="relative hidden sm:inline">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Nav({ active, onPick }: { active: string; onPick: (id: string) => void }) {
  return (
    <nav aria-label="Design system chapters">
      <ol className="flex flex-col gap-px">
        {CHAPTERS.map((c, i) => {
          const on = active === c.id;
          return (
            <li key={c.id}>
              <a
                href={`#${c.id}`}
                aria-current={on ? "location" : undefined}
                onClick={() => onPick(c.id)}
                className={cx(
                  "group flex h-8 items-center gap-3 rounded-t-md px-2.5 text-t-small transition-colors duration-(--t-dur-fast) ease-t-out",
                  on ? "bg-t-sunken font-medium text-t-ink" : "text-t-muted hover:text-t-ink",
                )}
              >
                <span className={cx("t-num w-5 text-t-caption", on ? "text-t-accent-text" : "text-t-subtle")}>{String(i + 1).padStart(2, "0")}</span>
                {c.label}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const IDS = CHAPTERS.map((c) => c.id);

export function Shell({ children }: { children: ReactNode }) {
  const pref = useSyncExternalStore(subscribePref, readPref, () => "light" as Pref);
  const system = useSyncExternalStore(subscribeSystem, readSystem, () => "light" as ThemeName);
  const [reduced, setReduced] = useState(false);
  const [active, setActive] = useScrollSpy(IDS);
  const [menu, setMenu] = useState(false);
  const choose = useCallback((p: Pref) => writePref(p), []);
  const theme: ThemeName = pref === "system" ? system : pref;

  return (
    <Scope theme={theme} density="app" reducedMotion={reduced} className="min-h-dvh">
      <TooltipProvider>
        <ToastProvider>
          <a href="#main" className="sr-only z-[70] rounded-t-md bg-t-inverse px-3 py-2 text-t-label text-t-inverse-text focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
            Skip to content
          </a>
          <div className="mx-auto grid max-w-[96rem] lg:grid-cols-[16.5rem_minmax(0,1fr)]">
            <aside className="sticky top-0 hidden h-dvh flex-col justify-between gap-8 py-8 pr-4 pl-6 lg:flex">
              <div className="flex flex-col gap-10">
                <div className="flex flex-col gap-1.5">
                  <Wordmark />
                  <p className="text-t-caption text-t-muted">Design system 2.0</p>
                </div>
                <Nav active={active} onPick={setActive} />
              </div>
              <p className="text-t-caption text-t-muted [text-wrap:pretty]">Internal reference. Nothing here ships to customers until a screen adopts it.</p>
            </aside>

            <div className="min-w-0">
              <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-t-line bg-t-canvas/85 px-5 backdrop-blur-md sm:px-8 lg:px-12">
                <div className="flex items-center gap-2 lg:hidden">
                  <Drawer open={menu} onOpenChange={setMenu}>
                    <DrawerTrigger asChild>
                      <IconButton icon={Menu} label="Chapters" variant="ghost" tooltip={false} />
                    </DrawerTrigger>
                    <DrawerContent title="Chapters" description="Jump to a part of the design system.">
                      <Nav active={active} onPick={() => setMenu(false)} />
                    </DrawerContent>
                  </Drawer>
                  <Wordmark markClassName="size-5" className="[&>span]:text-[0.9375rem]" />
                </div>
                <p className="hidden text-t-small text-t-muted lg:block">
                  <span className="text-t-ink">Design system</span> / version 2.0
                </p>
                <div className="flex items-center gap-3 sm:gap-5">
                  <div className="hidden items-center sm:flex">
                    <Switch label={<span className="text-t-label text-t-muted">Reduce motion</span>} checked={reduced} onCheckedChange={setReduced} className="items-center gap-3" />
                  </div>
                  <ThemeSwitch pref={pref} onChange={choose} />
                </div>
              </header>
              <main id="main" className="px-5 pb-32 sm:px-8 lg:px-12">
                <div className="mx-auto max-w-[62rem]">{children}</div>
              </main>
            </div>
          </div>
        </ToastProvider>
      </TooltipProvider>
    </Scope>
  );
}


