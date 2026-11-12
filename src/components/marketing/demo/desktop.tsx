"use client";

import Link from "next/link";
import { useState } from "react";
import { BellIcon, LogOutIcon, PlusIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/ui/brand-mark";
import { DecisionRows } from "@/ui/decision-table";
import { GROUPS, SETTINGS, navBadgeClass, navIconClass, navItemClass, type NavKey } from "@/ui/nav";
import { Page } from "@/ui/page";
import { Card, buttonClass } from "@/ui/primitives";
import { StatsGrid } from "@/ui/stats-grid";
import { AgentLines } from "./agent-lines";
import { DemoCard, DemoToast, useActivityRows, useStats } from "./parts";
import type { Demo } from "./use-demo";

type View = "home" | "activity";
/** Overview and Activity switch the view; the other entries show where they are, and stay put. */
const LIVE: NavKey[] = ["home", "activity"];

/**
 * The demo as a desktop app window, at the app's real size: the app's sidebar entries and their look (ui/nav.ts), the app's numbers,
 * cards and activity table. Always dark, whatever the visitor's system is set to.
 */
export function DemoDesktop({ demo }: { demo: Demo }) {
  const t = useT();
  const [view, setView] = useState<View>("home");
  return (
    <div className="ui-next dark relative overflow-hidden rounded-2xl border border-white/[0.12] bg-background shadow-[0_50px_140px_-40px_rgb(0_0_0/0.9),0_0_0_1px_rgb(0_0_0/0.6)]" data-theme="dark">
      <div className="grid h-10 grid-cols-[1fr_auto_1fr] items-center border-b border-white/[0.07] bg-[#1b1a18] px-4">
        <span aria-hidden className="flex gap-2"><span className="size-3 rounded-full bg-white/[0.13]" /><span className="size-3 rounded-full bg-white/[0.13]" /><span className="size-3 rounded-full bg-white/[0.13]" /></span>
        <span aria-hidden className="flex h-6 min-w-56 items-center justify-center rounded-md bg-white/[0.05] px-3 text-[12px] text-[#a9a296]">TEND · {view === "home" ? t.ui.nav.home : t.ui.nav.activity}</span>
        <span className="justify-self-end text-[12px] text-[#a9a296]">{t.front.demo.label}</span>
      </div>
      <div className="grid h-[1010px] grid-cols-[232px_minmax(0,1fr)] xl:h-[900px]">
        <Sidebar view={view} setView={setView} waiting={demo.waiting.length} />
        <div className="min-w-0 overflow-y-auto overscroll-contain">{view === "home" ? <Overview demo={demo} /> : <Activity demo={demo} />}</div>
      </div>
      <DemoToast demo={demo} className="absolute right-6 bottom-6 z-10" />
    </div>
  );
}

function Sidebar({ view, setView, waiting }: { view: View; setView: (v: View) => void; waiting: number }) {
  const t = useT();
  const g = t.ui.gateway;
  const still = "cursor-default hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent";
  return (
    <aside className="flex min-w-0 flex-col justify-between border-r border-border bg-sunken/50">
      <div className="grid gap-6 pt-6">
        <span className="flex items-center gap-3 px-5"><BrandMark className="size-6 shrink-0 text-primary" /><span className="text-[15px] font-semibold tracking-[0.16em]">TEND</span></span>
        <nav aria-label={t.ui.nav.label} className="grid gap-3">
          {GROUPS.map((group, i) => (
            <div key={group.key}>
              {i > 0 && <div aria-hidden className="mx-5 mb-3 border-t border-border" />}
              <div className="grid">
                {group.items.map((it) => {
                  const Icon = it.icon;
                  const active = it.key === view;
                  const inner = (
                    <>
                      <Icon className={navIconClass(active)} strokeWidth={1.75} aria-hidden />
                      <span>{t.ui.nav[it.key]}</span>
                      {it.key === "approvals" && waiting > 0 && (
                        <span className={navBadgeClass("full")}>
                          <span className="sr-only">, {t.ui.waitingLabel(waiting)}</span><span aria-hidden>{waiting}</span>
                        </span>
                      )}
                    </>
                  );
                  return LIVE.includes(it.key) ? (
                    <button key={it.key} type="button" aria-current={active ? "page" : undefined} onClick={() => setView(it.key as View)} className={cn(navItemClass(active, "full"), "w-full text-left")}>{inner}</button>
                  ) : (
                    <span key={it.key} className={cn(navItemClass(false, "full"), still)}>{inner}</span>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)]">
        <span className="mb-1 block border-t border-border px-5 py-3">
          <span className="flex items-center gap-2.5">
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
            <span className="flex min-w-0 items-baseline gap-2"><span className="text-[13px] text-muted-foreground">{g.label}</span><span className="text-[13px] font-medium">{g.connected}</span></span>
          </span>
          <span className="mt-1 block pl-[18px] text-[12px] text-muted-foreground">{g.agents(2)} · {g.syncedNow}</span>
        </span>
        <span className={cn(navItemClass(false, "full"), still)}><BellIcon className={navIconClass(false)} strokeWidth={1.75} aria-hidden /><span>{t.ui.nav.notifications}</span></span>
        <span className={cn(navItemClass(false, "full"), still)}><SETTINGS.icon className={navIconClass(false)} strokeWidth={1.75} aria-hidden /><span>{t.ui.nav.settings}</span></span>
        <span className="flex items-center gap-1 border-t border-border px-3 py-2.5">
          <span className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1">
            <span aria-hidden className="grid size-7 shrink-0 place-items-center border border-border bg-background text-[11px] font-semibold">OP</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{t.ui.operator}</span><span className="block truncate text-[12px] text-muted-foreground">{t.ui.signedIn}</span></span>
          </span>
          <span aria-hidden className="grid size-8 shrink-0 place-items-center text-muted-foreground"><LogOutIcon className="size-4" strokeWidth={1.75} /></span>
        </span>
      </div>
    </aside>
  );
}

function Overview({ demo }: { demo: Demo }) {
  const t = useT();
  const h = t.home;
  const d = h.dash;
  const stats = useStats(demo);
  const recent = useActivityRows(demo.activity).slice(0, 6);
  const n = demo.waiting.length;
  return (
    <Page full>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h2 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em]">{t.ui.nav.home}</h2>
          <p className="mt-2 max-w-[60ch] text-[15px] text-pretty text-muted-foreground">{d.purpose}</p>
        </div>
        <Link href="/docs" className={buttonClass("secondary")}><PlusIcon className="size-4" strokeWidth={1.75} aria-hidden />{h.connect}</Link>
      </header>

      <p className={`mt-8 text-[17px] ${n ? "font-medium text-foreground" : "text-muted-foreground"}`}>{n ? d.needYou(n) : d.allQuiet}</p>
      <StatsGrid stats={stats} className="mt-6" />

      {n > 0 ? (
        <section className="mt-10">
          <h3 className="text-[17px] font-medium">{d.needs}</h3>
          <div className="mt-4 grid grid-cols-2 items-start gap-4">
            <DemoCard waiting={demo.waiting[0]} onDecide={(decision) => demo.decide(demo.waiting[0].request.id, decision)} />
          </div>
        </section>
      ) : null}
      {/* The rest of the app's Overview (app/(next)/home/view.tsx): the agents, recent activity, and what TEND covers. */}
      <Card className="mt-10">
        <div className="flex items-center justify-between px-6 py-4"><h3 className="text-[17px] font-medium">{d.agents}</h3><span className="text-[14px] text-muted-foreground">{h.overview.viewAgents}</span></div>
        <AgentLines className="border-t border-border" invoice={demo.activity[0]?.outcome} />
        <footer className="flex items-center gap-2 border-t border-border px-5 py-3 text-[14px] text-muted-foreground"><PlusIcon className="size-4" strokeWidth={1.75} aria-hidden />{d.add}</footer>
      </Card>
      <Card className="mt-10">
        <div className="flex items-center justify-between px-6 py-4"><h3 className="text-[17px] font-medium">{h.recent.title}</h3><span className="text-[14px] text-muted-foreground">{h.recent.all}</span></div>
        <div className="border-t border-border"><DecisionRows rows={recent} agents compact /></div>
      </Card>
      <section className="mt-10 border-t border-border pt-6">
        <h3 className="text-[15px] font-medium">{d.covers.title}</h3>
        <p className="mt-2 max-w-[72ch] text-[14px] text-pretty text-muted-foreground">{d.covers.yes} {d.covers.no}</p>
      </section>
    </Page>
  );
}

function Activity({ demo }: { demo: Demo }) {
  const t = useT();
  const g = t.timelinePage;
  const rows = useActivityRows(demo.activity);
  return (
    <Page full>
      <h2 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em]">{g.title}</h2>
      <p className="mt-3 max-w-[70ch] text-[15px] text-muted-foreground">{g.description}</p>
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-sage" />
        <span className="font-medium text-foreground">{g.live}</span>
        <span>· {g.liveNote}</span>
      </p>
      {/* The app's filter row (app/(next)/timeline/view.tsx): the six groups, the agent picker and "More filters". */}
      <Card className="mt-8 flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="inline-flex rounded-md border border-border p-0.5 text-[13px]">
          {(["all", "approvals", "allowed", "blocked", "alerts", "changes"] as const).map((k, i) => <span key={k} className={cn("rounded-[5px] px-2.5 py-1", i === 0 ? "bg-elevated font-medium text-foreground" : "text-muted-foreground")}>{g.groups[k]}</span>)}
        </span>
        <span className="ml-auto text-[13px] text-muted-foreground underline underline-offset-4">{g.moreFilters}</span>
      </Card>
      <Card className="mt-4">
        <h3 className="bg-sunken px-6 py-2 text-[13px] font-medium text-muted-foreground">{t.time.today}</h3>
        <div className="border-t border-border"><DecisionRows rows={rows} agents /></div>
      </Card>
    </Page>
  );
}
