"use client";

import { useState } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { ActivityIcon, BellIcon, CheckIcon, CircleCheckIcon, LayoutGridIcon, XIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/ui/brand-mark";
import { DecisionRows } from "@/ui/decision-table";
import { StatsGrid } from "@/ui/stats-grid";
import { AllClear, DemoCard, DemoToast, useActivityRows, useStats } from "./parts";
import type { Demo, Waiting } from "./use-demo";

type Tab = "home" | "approvals" | "activity";
const TABS: [Tab, typeof LayoutGridIcon][] = [["home", LayoutGridIcon], ["approvals", CircleCheckIcon], ["activity", ActivityIcon]];

/** How far a card is dragged before letting go allows or declines it. */
const THRESHOLD = 110;

/**
 * The demo as the app looks on a phone: the app's phone header (the mark, TEND and the bell), the numbers two by two, one request in
 * focus with large buttons, and a tab bar. The same cards, numbers and table as the app, with the small words at 14px. Swiping a card
 * right allows it and left declines it; only sideways drags count, so the page still scrolls, and the buttons always work.
 */
export function DemoMobile({ demo }: { demo: Demo }) {
  const t = useT();
  const d = t.front.demo;
  const [tab, setTab] = useState<Tab>("home");
  const n = demo.waiting.length;
  return (
    <div
      className="ui-next dark relative mx-auto w-full max-w-[480px] overflow-hidden rounded-[24px] border border-white/[0.12] bg-background shadow-[0_40px_100px_-40px_rgb(0_0_0/0.9)]"
      data-theme="dark"
      // The card's small and caption sizes become 14px here, the least a phone screen should show.
      style={{ ["--text-caption" as string]: "0.875rem", ["--text-small" as string]: "0.875rem" }}
    >
      <header className="flex h-14 items-center justify-between border-b border-border px-4">
        <span className="flex items-center gap-3"><BrandMark className="size-6 text-primary" /><span className="text-[15px] font-semibold tracking-[0.16em]">TEND</span></span>
        <button type="button" onClick={() => setTab("approvals")} aria-label={d.bell(n)} className="relative grid size-11 place-items-center rounded-full text-foreground outline-none focus-visible:outline-2 focus-visible:outline-primary">
          <BellIcon className="size-5" strokeWidth={1.75} aria-hidden />
          {n > 0 && <span aria-hidden className="absolute top-1.5 right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground tabular-nums">{n}</span>}
        </button>
      </header>

      <div className="min-h-[640px] px-4 pt-6 pb-8">
        {tab === "home" && <Home demo={demo} />}
        {tab === "approvals" && <Approvals demo={demo} />}
        {tab === "activity" && <ActivityTab demo={demo} />}
      </div>

      <DemoToast demo={demo} className="absolute inset-x-4 bottom-[84px] z-10" />

      <nav aria-label={t.ui.nav.label} className="grid grid-cols-3 border-t border-border bg-sunken/50">
        {TABS.map(([key, Icon]) => {
          const on = tab === key;
          return (
            <button key={key} type="button" aria-current={on ? "page" : undefined} onClick={() => setTab(key)} className={cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[14px] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary", on ? "font-medium text-foreground" : "text-muted-foreground")}>
              <Icon className={cn("size-5", on && "text-primary")} strokeWidth={1.75} aria-hidden />
              {t.ui.nav[key]}
              {key === "approvals" && n > 0 && <span className="absolute top-2 left-[calc(50%+8px)] grid h-[18px] min-w-[18px] place-items-center border border-border bg-background px-1 text-[11px] font-medium tabular-nums"><span className="sr-only">{t.ui.waitingLabel(n)}: </span>{n}</span>}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function Title({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <>
      <h2 className="text-[26px] leading-[1.15] font-medium tracking-[-0.02em]">{children}</h2>
      {note && <p className="mt-2 text-[15px] text-pretty text-muted-foreground">{note}</p>}
    </>
  );
}

function Home({ demo }: { demo: Demo }) {
  const t = useT();
  const d = t.home.dash;
  const stats = useStats(demo);
  const n = demo.waiting.length;
  return (
    <>
      <Title note={d.purpose}>{t.ui.nav.home}</Title>
      <p className={`mt-6 text-[17px] ${n ? "font-medium text-foreground" : "text-muted-foreground"}`}>{n ? d.needYou(n) : d.allQuiet}</p>
      <StatsGrid stats={stats} roomy className="mt-4" />
      <h3 className="mt-8 text-[17px] font-medium">{d.needs}</h3>
      <Focus demo={demo} />
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
            variants={{ gone: (dir: number) => ({ opacity: 0, x: dir * 420, transition: { duration: 0.28 } }) }}
          >
            <Swipe waiting={first} reduce={!!reduce} onDecide={(decision) => { setLeaving(decision === "allowed" ? 1 : -1); demo.decide(first.request.id, decision); }} />
            <p aria-hidden className="mt-3 text-center text-[14px] text-muted-foreground">{d.swipe}</p>
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

/** A card that can be swiped: right allows, left declines, with the colour of the answer showing underneath while it moves. */
function Swipe({ waiting, onDecide, reduce }: { waiting: Waiting; onDecide: (decision: "allowed" | "denied") => void; reduce: boolean }) {
  const h = useT().home.request;
  const x = useMotionValue(0);
  const allow = useTransform(x, [0, THRESHOLD], [0, 1]);
  const deny = useTransform(x, [-THRESHOLD, 0], [1, 0]);
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
        style={{ x, touchAction: "pan-y" }}
        onDragEnd={(_, info) => {
          if (info.offset.x > THRESHOLD) onDecide("allowed");
          else if (info.offset.x < -THRESHOLD) onDecide("denied");
        }}
        className="relative [&_[data-slot=request-actions]]:grid [&_[data-slot=request-actions]]:grid-cols-2 [&_[data-slot=request-actions]>button]:w-full"
      >
        <DemoCard waiting={waiting} onDecide={onDecide} className="rounded-2xl border border-border bg-surface p-5" />
      </motion.div>
    </div>
  );
}
