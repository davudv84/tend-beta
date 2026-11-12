"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { BellIcon, MenuIcon, XIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/ui/brand-mark";
import { DecisionRows } from "@/ui/decision-table";
import { GROUPS, SETTINGS, navBadgeClass, navIconClass, navItemClass, type NavKey } from "@/ui/nav";
import { StatsGrid } from "@/ui/stats-grid";
import { useSeen } from "../kit";
import { AgentLines } from "./agent-lines";
import { DemoCard, DemoToast, useActivityRows, useStats } from "./parts";
import type { Demo } from "./use-demo";

type View = "home" | "approvals" | "activity";
/** The menu entries that switch the screen; the others show where they are and stay put, as in the desktop window. */
const LIVE: NavKey[] = ["home", "approvals", "activity"];

/** The notification's spring: quick and a little soft. */
const SPRING = { type: "spring", stiffness: 420, damping: 32, mass: 0.9 } as const;

/**
 * The demo as TEND in a phone's browser, inside an iPhone drawn at a real phone's size (375 by 812 points) and made smaller with `zoom`,
 * so the app keeps its real layout. Everything on the screen is the app's own phone layout (ui/shell.tsx below 768px): the header with
 * the brand, the notifications bell and the Menu button (its dot says something waits), which opens the app's menu as a drawer. The
 * notification that drops in is TEND's real Web Push notification (server/push.ts): it says only that an approval is needed, and a tap
 * opens TEND, where the request is answered. The Dynamic Island is the phone's own; TEND puts nothing in it.
 */
export function DemoMobile({ demo }: { demo: Demo }) {
  const t = useT();
  const d = t.front.demo;
  const [view, setView] = useState<View>("home");
  const [menu, setMenu] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [ref, seen] = useSeen<HTMLDivElement>("0px 0px -25% 0px");
  const n = demo.waiting.length;
  const reduce = useReducedMotion();
  // Once the phone is on screen, the push notification arrives; a few seconds later (or on a tap) it goes, as iOS banners do.
  const [banner, setBanner] = useState<"idle" | "shown" | "gone">("idle");
  useEffect(() => {
    if (!seen) return;
    const show = window.setTimeout(() => setBanner("shown"), reduce ? 0 : 900);
    const hide = window.setTimeout(() => setBanner((b) => (b === "shown" ? "gone" : b)), reduce ? 6000 : 6400);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, [seen, reduce]);
  const go = (next: View) => {
    setView(next);
    setMenu(false);
    scroller.current?.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };
  return (
    <div ref={ref} className="mx-auto w-fit [zoom:0.62] min-[375px]:[zoom:0.66] min-[430px]:[zoom:0.7] md:[zoom:0.8]">
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
            {/* The Dynamic Island: the phone's own, nothing in it. */}
            <span aria-hidden className="pointer-events-none absolute top-[11px] left-1/2 z-20 h-[37px] w-[124px] -translate-x-1/2 rounded-full bg-black" />
            <Notification show={banner === "shown" && n > 0} reduce={!!reduce} onOpen={() => { setBanner("gone"); go("approvals"); }} />

            {/* The app's phone header (ui/shell.tsx): brand, the notifications bell, and Menu with a dot while something waits. */}
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <span className="flex items-center gap-3"><BrandMark className="size-6 text-primary" /><span className="text-[15px] font-semibold tracking-[0.16em]">TEND</span></span>
              <span className="flex items-center">
                <span aria-hidden className="relative grid size-10 place-items-center text-foreground">
                  <BellIcon className="size-5" strokeWidth={1.75} />
                  {banner !== "idle" && <span className="absolute top-1.5 right-1 grid h-[16px] min-w-[16px] place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums">1</span>}
                </span>
                <button type="button" onClick={() => setMenu(true)} aria-label={t.ui.menu} aria-expanded={menu} className="relative grid size-10 place-items-center text-foreground outline-none focus-visible:outline-2 focus-visible:outline-primary">
                  <MenuIcon className="size-5" strokeWidth={1.75} aria-hidden />
                  {n > 0 && <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-primary" />}
                </button>
              </span>
            </header>

            {/* The screen scrolls on its own, like the app; at its ends the page takes over. */}
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 pt-6 pb-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {view === "home" && <Home demo={demo} />}
              {view === "approvals" && <Approvals demo={demo} />}
              {view === "activity" && <ActivityView demo={demo} />}
            </div>

            <Drawer open={menu} view={view} waiting={n} onGo={go} onClose={() => setMenu(false)} />
            <DemoToast demo={demo} className="absolute inset-x-4 bottom-8 z-10" />
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
    <div aria-hidden className="relative z-10 flex h-[54px] shrink-0 items-center justify-between pt-[6px] pr-7 pl-8 text-[16px] font-semibold tracking-[-0.01em] text-foreground">
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
 * TEND's push notification as a phone shows it: its real title and body (server/push.ts). It carries no request details and no
 * buttons; a tap opens TEND's Approvals, where the request is answered.
 */
function Notification({ show, reduce, onOpen }: { show: boolean; reduce: boolean; onOpen: () => void }) {
  const t = useT();
  const p = t.notify.push.approval;
  return (
    <AnimatePresence initial={false}>
      {show && (
        <m.button
          key="push"
          type="button"
          onClick={onOpen}
          initial={reduce ? { opacity: 0 } : { y: -130, scale: 0.94, opacity: 0.6 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: -130, scale: 0.94, opacity: 0, transition: { duration: 0.32, ease: [0.4, 0, 1, 1] } }}
          transition={reduce ? { duration: 0 } : SPRING}
          className="absolute inset-x-[10px] top-[10px] z-30 flex items-start gap-3 rounded-[26px] border border-white/10 bg-[#262626]/85 p-3.5 text-left text-white shadow-[0_18px_40px_-12px_rgb(0_0_0/0.8)] backdrop-blur-xl outline-none active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-primary"
        >
          <span aria-hidden className="grid size-[38px] shrink-0 place-items-center rounded-[10px] bg-[#ede8de] text-[#131211]"><BrandMark className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between text-[13px] text-white/55"><span className="font-medium text-white/70">tendhq.dev</span>{t.front.demo.now}</span>
            <span className="mt-0.5 block text-[15px] leading-snug font-semibold">{p.title}</span>
            <span className="mt-0.5 block text-[14px] leading-snug text-white/70">{p.body}</span>
          </span>
        </m.button>
      )}
    </AnimatePresence>
  );
}

/** The app's menu as a drawer from the left, with the same entries as the desktop sidebar (ui/nav.ts). */
function Drawer({ open, view, waiting, onGo, onClose }: { open: boolean; view: View; waiting: number; onGo: (v: View) => void; onClose: () => void }) {
  const t = useT();
  const still = "cursor-default hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent";
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-label={t.ui.menu}>
      <button type="button" aria-label={t.ui.closeMenu} onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-y-0 left-0 flex w-[288px] flex-col border-r border-border bg-sunken pt-14">
        <button type="button" onClick={onClose} aria-label={t.ui.closeMenu} className="absolute top-3 right-3 grid size-9 place-items-center text-muted-foreground outline-none hover:text-foreground"><XIcon className="size-5" strokeWidth={1.75} aria-hidden /></button>
        <span className="flex items-center gap-3 px-5 pb-6"><BrandMark className="size-6 text-primary" /><span className="text-[15px] font-semibold tracking-[0.16em]">TEND</span></span>
        <nav aria-label={t.ui.nav.label} className="grid gap-3">
          {GROUPS.map((group, i) => (
            <div key={group.key}>
              {i > 0 && <div aria-hidden className="mx-5 mb-3 border-t border-border" />}
              {group.items.map((it) => {
                const Icon = it.icon;
                const active = it.key === view;
                const inner = (
                  <>
                    <Icon className={navIconClass(active)} strokeWidth={1.75} aria-hidden />
                    <span>{t.ui.nav[it.key]}</span>
                    {it.key === "approvals" && waiting > 0 && <span className={navBadgeClass("full")}><span className="sr-only">, {t.ui.waitingLabel(waiting)}</span><span aria-hidden>{waiting}</span></span>}
                  </>
                );
                return LIVE.includes(it.key)
                  ? <button key={it.key} type="button" aria-current={active ? "page" : undefined} onClick={() => onGo(it.key as View)} className={cn(navItemClass(active, "full"), "w-full text-left")}>{inner}</button>
                  : <span key={it.key} className={cn(navItemClass(false, "full"), still)}>{inner}</span>;
              })}
            </div>
          ))}
        </nav>
        <div className="mt-auto border-t border-border">
          <span className={cn(navItemClass(false, "full"), still)}><SETTINGS.icon className={navIconClass(false)} strokeWidth={1.75} aria-hidden /><span>{t.ui.nav.settings}</span></span>
        </div>
      </div>
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

/** Overview, in the app's order: the line, the four numbers, what needs you, the agents, recent activity. */
function Home({ demo }: { demo: Demo }) {
  const t = useT();
  const d = t.home.dash;
  const stats = useStats(demo);
  const rows = useActivityRows(demo.activity);
  const n = demo.waiting.length;
  return (
    <>
      <Title note={d.purpose}>{t.ui.nav.home}</Title>
      <p className={`mt-6 text-[16px] ${n ? "font-medium text-foreground" : "text-muted-foreground"}`}>{n ? d.needYou(n) : d.allQuiet}</p>
      <StatsGrid stats={stats} roomy className="mt-5" />
      {n > 0 && (
        <section className="mt-8">
          <h3 className="text-[17px] font-medium">{d.needs}</h3>
          <DemoCard waiting={demo.waiting[0]} onDecide={(decision) => demo.decide(demo.waiting[0].request.id, decision)} className="mt-4 rounded-2xl border border-border bg-surface p-5" />
        </section>
      )}
      <section className="mt-8 overflow-hidden rounded-xl border border-border bg-surface">
        <h3 className="px-5 py-4 text-[15px] font-medium">{d.agents}</h3>
        <AgentLines className="border-t border-border" invoice={demo.activity[0]?.outcome} />
      </section>
      <section className="mt-8 overflow-hidden rounded-xl border border-border bg-surface">
        <h3 className="px-5 py-4 text-[15px] font-medium">{t.home.recent.title}</h3>
        <div className="border-t border-border"><DecisionRows rows={rows.slice(0, 4)} agents phone compact /></div>
      </section>
    </>
  );
}

/** Approvals (the app's /oversight): its tabs, what waits for a decision, and the decision history. */
function Approvals({ demo }: { demo: Demo }) {
  const t = useT();
  const o = t.oversightPage;
  const rows = useActivityRows(demo.activity).filter((r) => r.outcome === "approved" || r.outcome === "rejected" || r.outcome === "expired");
  return (
    <>
      <Title note={o.description}>{o.title}</Title>
      <div className="-mx-4 mt-5 flex gap-1 overflow-x-auto px-4 text-[14px] [scrollbar-width:none]">
        {([o.tabs.authorizations, o.tabs.queue, o.tabs.log, o.tabs.controls, o.tabs.connected] as string[]).map((label, i) => (
          <span key={label} className={cn("shrink-0 rounded-md px-3 py-1.5", i === 0 ? "bg-elevated font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
        ))}
      </div>
      <h3 className="mt-7 text-[17px] font-medium">{o.waitingTitle}</h3>
      <p className="mt-1 text-[14px] text-muted-foreground">{o.waitingSub}</p>
      {demo.waiting[0]
        ? <DemoCard waiting={demo.waiting[0]} onDecide={(decision) => demo.decide(demo.waiting[0].request.id, decision)} className="mt-4 rounded-2xl border border-border bg-surface p-5" />
        : <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-6 text-center text-[14px] text-muted-foreground">{o.nothingWaiting}</p>}
      <h3 className="mt-8 text-[17px] font-medium">{o.historyTitle}</h3>
      <div className="-mx-4 mt-3 border-y border-border">{rows.length ? <DecisionRows rows={rows} agents phone /> : <p className="px-4 py-5 text-[14px] text-muted-foreground">{o.noHistory}</p>}</div>
    </>
  );
}

/** Activity: the app's filter and table, one row per action with the path it took. */
function ActivityView({ demo }: { demo: Demo }) {
  const t = useT();
  const g = t.timelinePage;
  const rows = useActivityRows(demo.activity);
  return (
    <>
      <Title note={g.description}>{g.title}</Title>
      <div className="-mx-4 mt-5 flex gap-1 overflow-x-auto px-4 text-[14px] [scrollbar-width:none]">
        {(["all", "approvals", "allowed", "blocked", "alerts", "changes"] as const).map((k, i) => (
          <span key={k} className={cn("shrink-0 rounded-md px-3 py-1.5", i === 0 ? "bg-elevated font-medium text-foreground" : "text-muted-foreground")}>{g.groups[k]}</span>
        ))}
      </div>
      <p className="mt-3 text-[14px] text-muted-foreground underline underline-offset-4">{g.moreFilters}</p>
      <div className="-mx-4 mt-5 border-y border-border"><DecisionRows rows={rows} agents phone /></div>
    </>
  );
}
