"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { ActivityIcon, BellIcon, CheckIcon, CircleCheckIcon, LayoutGridIcon, XIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/ui/brand-mark";
import { DecisionRows } from "@/ui/decision-table";
import { StatsGrid } from "@/ui/stats-grid";
import { useSeen } from "../kit";
import { AllClear, DemoCard, useActivityRows, useStats } from "./parts";
import type { Demo, Waiting } from "./use-demo";

type Tab = "home" | "approvals" | "activity";
const TABS: [Tab, typeof LayoutGridIcon][] = [["home", LayoutGridIcon], ["approvals", CircleCheckIcon], ["activity", ActivityIcon]];

/** How far a card is dragged before letting go allows or declines it. */
const THRESHOLD = 110;

/** A short tap of the phone's motor where there is one (Android); nothing anywhere else. */
const buzz = (ms: number | number[]) => {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
};

/** The island's spring: quick and a little soft, as the real one moves. */
const SPRING = { type: "spring", stiffness: 420, damping: 32, mass: 0.9 } as const;

/**
 * The demo as the app on an iPhone: the whole phone is drawn at a real phone's size (375 by 812 points) and made smaller with `zoom`,
 * so the app inside keeps its real layout and the phone fits a phone's screen with room around it. The status bar has a Dynamic Island
 * that shows what waits (TEND's mark and the count) and, after an answer, opens to say what happened, then closes again. Once.
 */
export function DemoMobile({ demo }: { demo: Demo }) {
  const t = useT();
  const d = t.front.demo;
  const [tab, setTab] = useState<Tab>("home");
  const scroller = useRef<HTMLDivElement>(null);
  const [ref, seen] = useSeen<HTMLDivElement>("0px 0px -25% 0px");
  const n = demo.waiting.length;
  const go = (next: Tab) => {
    setTab(next);
    scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <div ref={ref} className="mx-auto w-fit [zoom:0.68] min-[375px]:[zoom:0.78] min-[430px]:[zoom:0.84] md:[zoom:0.92]">
      <figure aria-label={d.phone} className="relative m-0 rounded-[64px] bg-[linear-gradient(145deg,#3a3a3a,#141414_30%,#0b0b0b_70%,#2a2a2a)] p-[3px] shadow-[0_60px_120px_-40px_rgb(0_0_0/0.95),0_0_0_1px_rgb(255_255_255/0.06)]">
        {/* The buttons on the sides: action and volume on the left, power on the right. */}
        <span aria-hidden className="absolute top-[118px] -left-[3px] h-8 w-[3px] rounded-l-sm bg-[#2b2b2b]" />
        <span aria-hidden className="absolute top-[176px] -left-[3px] h-[60px] w-[3px] rounded-l-sm bg-[#2b2b2b]" />
        <span aria-hidden className="absolute top-[248px] -left-[3px] h-[60px] w-[3px] rounded-l-sm bg-[#2b2b2b]" />
        <span aria-hidden className="absolute top-[200px] -right-[3px] h-[92px] w-[3px] rounded-r-sm bg-[#2b2b2b]" />
        <div className="rounded-[61px] bg-black p-[11px]">
          <div
            className="ui-next dark relative flex h-[812px] w-[375px] flex-col overflow-hidden rounded-[50px] bg-background"
            data-theme="dark"
            // The card's small and caption sizes are 14px here, as the app draws them on a phone.
            style={{ ["--text-caption" as string]: "0.875rem", ["--text-small" as string]: "0.875rem" }}
          >
            <StatusBar />
            <Island demo={demo} seen={seen} onOpen={() => go("approvals")} />

            <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <span className="flex items-center gap-3"><BrandMark className="size-6 text-primary" /><span className="text-[15px] font-semibold tracking-[0.16em]">TEND</span></span>
              <button type="button" onClick={() => go("approvals")} aria-label={d.bell(n)} className="relative grid size-11 place-items-center rounded-full text-foreground outline-none transition-transform active:scale-90 focus-visible:outline-2 focus-visible:outline-primary">
                <BellIcon className="size-5" strokeWidth={1.75} aria-hidden />
                {n > 0 && <span aria-hidden className="absolute top-1.5 right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground tabular-nums">{n}</span>}
              </button>
            </header>

            {/* The screen scrolls on its own, like the app; at its ends the page takes over. */}
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-y-auto px-4 pt-5 pb-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {tab === "home" && <Home demo={demo} />}
              {tab === "approvals" && <Approvals demo={demo} />}
              {tab === "activity" && <ActivityTab demo={demo} />}
            </div>

            <nav aria-label={t.ui.nav.label} className="grid shrink-0 grid-cols-3 border-t border-border bg-sunken/80 pb-[26px] backdrop-blur-xl">
              {TABS.map(([key, Icon]) => {
                const on = tab === key;
                return (
                  <button key={key} type="button" aria-current={on ? "page" : undefined} onClick={() => go(key)} className={cn("relative flex h-14 flex-col items-center justify-center gap-1 text-[12px] outline-none transition-transform active:scale-95 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary", on ? "font-medium text-foreground" : "text-muted-foreground")}>
                    <Icon className={cn("size-[22px]", on && "text-primary")} strokeWidth={1.75} aria-hidden />
                    {t.ui.nav[key]}
                    {key === "approvals" && n > 0 && <span className="absolute top-1.5 left-[calc(50%+6px)] grid h-[17px] min-w-[17px] place-items-center rounded-full bg-primary px-1 text-[10.5px] font-semibold text-primary-foreground tabular-nums"><span className="sr-only">{t.ui.waitingLabel(n)}: </span>{n}</span>}
                  </button>
                );
              })}
            </nav>
            {/* The home indicator. */}
            <span aria-hidden className="pointer-events-none absolute bottom-2 left-1/2 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-white/80" />
          </div>
        </div>
      </figure>
    </div>
  );
}

/** The time on the left, signal, Wi-Fi and battery on the right, with room for the island between. Drawn, not real. */
function StatusBar() {
  return (
    <div aria-hidden className="relative z-10 flex h-[54px] shrink-0 items-center justify-between pr-7 pl-8 pt-[6px] text-[16px] font-semibold tracking-[-0.01em] text-foreground">
      <span className="w-[54px] text-center tabular-nums">9:41</span>
      <span className="flex items-center gap-[6px]">
        <svg viewBox="0 0 18 12" className="h-[11px] w-[17px] fill-current"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" /><rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
        <svg viewBox="0 0 16 12" className="h-[11px] w-[15px] fill-current"><path d="M8 2.4c2.2 0 4.2.8 5.7 2.2l1.2-1.3C13 1.5 10.6.6 8 .6S3 1.5 1.1 3.3l1.2 1.3C3.8 3.2 5.8 2.4 8 2.4Zm0 3.6c1.2 0 2.3.4 3.2 1.2l1.2-1.3C11.2 4.8 9.7 4.2 8 4.2s-3.2.6-4.4 1.7l1.2 1.3C5.7 6.4 6.8 6 8 6Zm0 3.5c-.6 0-1.1.2-1.5.6L8 11.7l1.5-1.6c-.4-.4-.9-.6-1.5-.6Z" /></svg>
        <span className="relative flex h-[12.5px] w-[26px] items-center rounded-[4px] border border-current/40 p-[1.5px]"><span className="h-full w-[72%] rounded-[2px] bg-current" /><span className="absolute top-1/2 -right-[3.5px] h-1 w-[1.5px] -translate-y-1/2 rounded-r-sm bg-current/40" /></span>
      </span>
    </div>
  );
}

/**
 * The Dynamic Island. Closed it is the black pill. Once the phone is on screen, a request "arrives": the island widens to show TEND's
 * mark and how many wait, and a tap opens Approvals. After an answer it opens wide with what happened and closes when the note goes.
 * Nothing repeats.
 */
function Island({ demo, seen, onOpen }: { demo: Demo; seen: boolean; onOpen: () => void }) {
  const d = useT().front.demo;
  const reduce = useReducedMotion();
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    if (!seen) return;
    const id = window.setTimeout(() => { setArrived(true); buzz(8); }, reduce ? 0 : 900);
    return () => clearTimeout(id);
  }, [seen, reduce]);
  const n = demo.waiting.length;
  const toast = demo.toast;
  const mode: "idle" | "compact" | "open" = toast ? "open" : arrived && n > 0 ? "compact" : "idle";
  const size = mode === "open" ? { width: 351, height: 82, borderRadius: 40 } : mode === "compact" ? { width: 188, height: 37, borderRadius: 20 } : { width: 124, height: 37, borderRadius: 20 };
  const allowed = toast?.decision === "allowed";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[11px] z-20 flex justify-center">
      <motion.button
        type="button"
        tabIndex={mode === "compact" ? 0 : -1}
        aria-hidden={mode !== "compact"}
        aria-label={mode === "compact" ? d.bell(n) : undefined}
        onClick={mode === "compact" ? onOpen : undefined}
        initial={false}
        animate={size}
        transition={reduce ? { duration: 0 } : SPRING}
        className={cn("relative overflow-hidden bg-black text-white outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", mode === "compact" && "pointer-events-auto cursor-pointer active:brightness-125")}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {mode === "compact" && (
            <motion.span key="compact" initial={{ opacity: 0, filter: "blur(4px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={{ opacity: 0, filter: "blur(4px)" }} transition={{ duration: reduce ? 0 : 0.22, delay: reduce ? 0 : 0.08 }} className="absolute inset-0 flex items-center justify-between pr-3 pl-2.5">
              <span className="grid size-[24px] place-items-center rounded-full bg-[#ede8de] text-[#131211]"><BrandMark className="size-3.5" /></span>
              <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#e8b14f] tabular-nums"><span className="size-[6px] rounded-full bg-[#e8b14f]" />{d.island.waiting(n)}</span>
            </motion.span>
          )}
          {mode === "open" && (
            <motion.span key="open" initial={{ opacity: 0, filter: "blur(6px)", scale: 0.96 }} animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }} exit={{ opacity: 0, filter: "blur(6px)" }} transition={{ duration: reduce ? 0 : 0.26, delay: reduce ? 0 : 0.1 }} className="absolute inset-0 flex items-center gap-3 px-4 text-left">
              <span className="grid size-[44px] shrink-0 place-items-center rounded-[14px] bg-[#ede8de] text-[#131211]"><BrandMark className="size-6" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{allowed ? d.island.allowed : d.island.denied}</span>
                <span className="block truncate text-[13px] text-white/60">{allowed ? d.island.ran : d.island.stopped}</span>
              </span>
              <span className={cn("grid size-[34px] shrink-0 place-items-center rounded-full", allowed ? "bg-primary text-primary-foreground" : "bg-clay text-white")}>
                {allowed ? <CheckIcon className="size-[18px]" strokeWidth={2.5} /> : <XIcon className="size-[18px]" strokeWidth={2.5} />}
              </span>
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}

function Title({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <>
      <h2 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.025em]">{children}</h2>
      {note && <p className="mt-2 text-[15px] text-pretty text-muted-foreground">{note}</p>}
    </>
  );
}

/** Overview, with what needs you first, as the app puts it on a phone; the four numbers below. */
function Home({ demo }: { demo: Demo }) {
  const t = useT();
  const d = t.home.dash;
  const stats = useStats(demo);
  const n = demo.waiting.length;
  return (
    <>
      <Title>{t.ui.nav.home}</Title>
      <p className={`mt-2 text-[16px] ${n ? "font-medium text-foreground" : "text-muted-foreground"}`}>{n ? d.needYou(n) : d.allQuiet}</p>
      <Focus demo={demo} />
      <StatsGrid stats={stats} roomy className="mt-8" />
    </>
  );
}

function Approvals({ demo }: { demo: Demo }) {
  const t = useT();
  return (
    <>
      <Title>{t.ui.nav.approvals}</Title>
      <Focus demo={demo} />
    </>
  );
}

function ActivityTab({ demo }: { demo: Demo }) {
  const t = useT();
  const g = t.timelinePage;
  const rows = useActivityRows(demo.activity);
  return (
    <>
      <Title note={g.description}>{g.title}</Title>
      <p className="mt-3 flex items-center gap-2 text-[14px] text-muted-foreground"><span aria-hidden className="size-1.5 rounded-full bg-sage" /><span className="font-medium text-foreground">{g.live}</span></p>
      <div className="-mx-4 mt-6 border-y border-border"><DecisionRows rows={rows} agents phone /></div>
    </>
  );
}

/** The waiting request in focus, and how to swipe it. */
function Focus({ demo }: { demo: Demo }) {
  const t = useT();
  const d = t.front.demo;
  const reduce = useReducedMotion();
  const [first] = demo.waiting;
  const [leaving, setLeaving] = useState(0);
  // The card leaves the way it was swiped (or fades, after a button), and then "All clear" takes its place.
  return (
    <div className="mt-4">
      <AnimatePresence initial={false} mode="wait" custom={leaving}>
        {first ? (
          <motion.div
            key="card"
            custom={leaving}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : "gone"}
            variants={{ gone: (dir: number) => ({ opacity: 0, x: dir * 420, rotate: dir * 6, transition: { duration: 0.3 } }) }}
          >
            <Swipe waiting={first} reduce={!!reduce} onDecide={(decision) => { buzz(decision === "allowed" ? [10, 40, 18] : 22); setLeaving(decision === "allowed" ? 1 : -1); demo.decide(first.request.id, decision); }} />
            <p aria-hidden className="mt-3 text-center text-[13px] text-muted-foreground">{d.swipe}</p>
          </motion.div>
        ) : (
          <motion.div key="clear" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.3 }}>
            <AllClear />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * A card that can be swiped: right allows, left declines, with the colour of the answer showing underneath while it moves and a
 * small tap of the motor when it is far enough to count. The card tilts a little with the drag, like a card held in a hand.
 */
function Swipe({ waiting, onDecide, reduce }: { waiting: Waiting; onDecide: (decision: "allowed" | "denied") => void; reduce: boolean }) {
  const h = useT().home.request;
  const x = useMotionValue(0);
  const allow = useTransform(x, [0, THRESHOLD], [0, 1]);
  const deny = useTransform(x, [-THRESHOLD, 0], [1, 0]);
  const rotate = useTransform(x, [-300, 0, 300], reduce ? [0, 0, 0] : [-4, 0, 4]);
  const past = useRef(false);
  return (
    <div className="relative">
      <motion.div aria-hidden style={{ opacity: allow }} className="absolute inset-0 flex items-center gap-2 rounded-2xl bg-primary/25 pl-6 text-[15px] font-medium text-primary"><CheckIcon className="size-5" strokeWidth={2} />{h.allow}</motion.div>
      <motion.div aria-hidden style={{ opacity: deny }} className="absolute inset-0 flex items-center justify-end gap-2 rounded-2xl bg-clay/25 pr-6 text-[15px] font-medium text-clay">{h.deny}<XIcon className="size-5" strokeWidth={2} /></motion.div>
      <motion.div
        drag="x"
        dragDirectionLock
        dragSnapToOrigin
        dragElastic={0.6}
        dragTransition={reduce ? { bounceStiffness: 1000, bounceDamping: 100 } : undefined}
        style={{ x, rotate, touchAction: "pan-y" }}
        onDrag={(_, info) => {
          const over = Math.abs(info.offset.x) > THRESHOLD;
          if (over !== past.current) { past.current = over; if (over) buzz(6); }
        }}
        onDragEnd={(_, info) => {
          past.current = false;
          if (info.offset.x > THRESHOLD) onDecide("allowed");
          else if (info.offset.x < -THRESHOLD) onDecide("denied");
        }}
        className="relative cursor-grab active:cursor-grabbing [&_[data-slot=request-actions]]:grid [&_[data-slot=request-actions]]:grid-cols-2 [&_[data-slot=request-actions]>button]:w-full"
      >
        <DemoCard waiting={waiting} onDecide={onDecide} className="rounded-2xl border border-border bg-surface p-5" />
      </motion.div>
    </div>
  );
}
