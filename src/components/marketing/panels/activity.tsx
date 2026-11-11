"use client";

import { useEffect, useMemo, useState } from "react";
import { ActivityIcon, CheckIcon, LinkIcon, SearchIcon, XIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { Badge, buttonClass, type Tone } from "@/ui/primitives";
import { StatsGrid } from "@/ui/stats-grid";
import { AppPanel, ExampleTag, prefersReducedMotion } from "../kit";
import { ACTION, DAY, GROUP_OF, LOG, agentOf, sum, type LogEntry, type Outcome } from "../site-data";
import { AgentMark } from "./common";

const OUTCOME_TONE: Record<Outcome, Tone> = { allowed: "good", approved: "good", needs_approval: "attention", blocked: "danger", rejected: "danger" };
type Filter = "all" | "allowed" | "waiting" | "blocked";

function OutcomeBadge({ outcome, className }: { outcome: Outcome; className?: string }) {
  const t = useT();
  return <Badge tone={OUTCOME_TONE[outcome]} className={className}>{t.timelinePage.outcome[outcome]}</Badge>;
}

/** Who or what decided an entry, in the app's words. */
function useDecidedBy() {
  const t = useT();
  const k = t.front.kit;
  return (e: LogEntry) => (e.by === "person" ? k.log.person : e.by === "unlisted" ? k.because.unlisted : k.log.rule(t.tools.choice[e.by]));
}

/** The activity log as in the app: search, a filter by outcome, and an entry opened to see what decided it and how it is chained. */
export function ActivityPanel() {
  const t = useT();
  const k = t.front.kit;
  const l = k.log;
  const decidedBy = useDecidedBy();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<number | null>(6);
  const query = q.trim().toLowerCase();
  const rows = LOG.filter((e) => (filter === "all" || GROUP_OF[e.outcome] === filter) && (!query || [agentOf(e.agent).name, k.calls[e.tool], e.tool, t.timelinePage.outcome[e.outcome]].some((s) => s.toLowerCase().includes(query))));
  const entry = LOG.find((e) => e.id === open && rows.includes(e));
  const prev = entry && LOG.find((e) => e.id === entry.id - 1);
  return (
    <AppPanel title={t.ui.nav.activity} icon={ActivityIcon} right={<><span className="hidden items-center gap-1.5 sm:flex"><span aria-hidden className="size-1.5 rounded-full bg-sage" />{t.timelinePage.live}</span><ExampleTag /></>} bodyClassName="grid grid-cols-1 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <div className="min-w-0 border-b border-border lg:border-r lg:border-b-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <label className="relative min-w-[180px] flex-1">
            <span className="sr-only">{l.search}</span>
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint" strokeWidth={1.75} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={l.search} className="h-9 w-full rounded-lg border border-border bg-background pr-3 pl-8 text-[13px] outline-none placeholder:text-faint focus-visible:border-primary" />
          </label>
          <div role="radiogroup" aria-label={t.timelinePage.title} className="inline-flex rounded-lg border border-border bg-sunken/60 p-0.5">
            {(["all", "allowed", "waiting", "blocked"] as const).map((f) => (
              <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} className={cn("h-8 rounded-md px-2.5 text-[12px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-primary", filter === f ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground")}>{f === "all" ? l.all : l.filters[f]}</button>
            ))}
          </div>
        </div>
        <div className="text-[13px]">
          <div aria-hidden className="hidden grid-cols-[52px_130px_minmax(0,1fr)_120px] gap-3 border-b border-border px-4 py-2 text-[12px] text-muted-foreground sm:grid">
            <span>{l.columns.time}</span><span>{l.columns.agent}</span><span>{l.columns.request}</span><span>{l.columns.outcome}</span>
          </div>
          {rows.map((e) => (
            <button key={e.id} type="button" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)} className={cn("grid w-full grid-cols-[44px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 text-left outline-none transition-colors last:border-b-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:grid-cols-[52px_130px_minmax(0,1fr)_120px]", open === e.id ? "bg-white/[0.05]" : "hover:bg-white/[0.025]")}>
              <span className="text-muted-foreground tabular-nums">{e.time}</span>
              <span className="flex min-w-0 items-center gap-2"><AgentMark agent={e.agent} className="size-5" /><span className="truncate">{agentOf(e.agent).name}</span></span>
              <span className="col-start-2 min-w-0 sm:col-start-auto"><span className="block truncate">{k.calls[e.tool]}</span><span className="block truncate font-mono text-[11px] text-muted-foreground">{e.tool}.{ACTION[e.tool]}</span></span>
              <span className="col-start-2 sm:col-start-auto"><OutcomeBadge outcome={e.outcome} className="h-5 text-[11px]" /></span>
            </button>
          ))}
          {!rows.length && <p className="px-4 py-10 text-center text-muted-foreground">{l.none}</p>}
        </div>
      </div>
      <div aria-live="polite" className="p-4">
        {entry ? (
          <div className="grid gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-[12px] text-muted-foreground tabular-nums">{entry.time} · {agentOf(entry.agent).name}</p><p className="mt-1 text-[14px] font-medium">{k.calls[entry.tool]}</p></div>
              <button type="button" onClick={() => setOpen(null)} aria-label={l.close} className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"><XIcon className="size-4" strokeWidth={1.75} aria-hidden /></button>
            </div>
            <OutcomeBadge outcome={entry.outcome} className="justify-self-start" />
            <dl className="grid gap-3 text-[13px]">
              <div><dt className="text-muted-foreground">{l.decidedBy}</dt><dd className="mt-0.5">{decidedBy(entry)}</dd></div>
              <div><dt className="text-muted-foreground">{t.front.demo.rows.tool}</dt><dd className="mt-0.5 font-mono text-[12px]">{entry.tool}.{ACTION[entry.tool]}</dd></div>
              <div><dt className="text-muted-foreground">{l.hash}</dt><dd className="mt-0.5 font-mono text-[12px]">#{entry.hash}</dd></div>
              <div><dt className="text-muted-foreground">{l.previous}</dt><dd className="mt-0.5 flex items-center gap-1.5 font-mono text-[12px]"><LinkIcon className="size-3 text-muted-foreground" strokeWidth={1.75} aria-hidden />{prev ? `#${prev.hash}` : "—"}</dd></div>
            </dl>
          </div>
        ) : <p className="py-10 text-center text-[13px] text-muted-foreground">{t.front.product.activity.main[1]}</p>}
      </div>
    </AppPanel>
  );
}

/**
 * The hash chain, checked link by link. "Change an entry" alters one entry's outcome as someone with database access could; checking
 * again stops at that entry. The check runs only when asked.
 */
export function ChainPanel() {
  const t = useT();
  const c = t.front.kit.chain;
  const rows = useMemo(() => [...LOG].reverse(), []);
  const TAMPERED = 4;
  const [tampered, setTampered] = useState(false);
  const [checked, setChecked] = useState(0);
  const [started, setStarted] = useState(false);
  const stopAt = tampered ? rows.findIndex((e) => e.id === TAMPERED) + 1 : rows.length;
  const running = started && checked < stopAt;
  useEffect(() => {
    if (!running) return;
    const id = window.setTimeout(() => setChecked((n) => n + 1), prefersReducedMotion() ? 0 : 220);
    return () => clearTimeout(id);
  }, [running, checked]);
  const finished = started && checked >= stopAt;
  return (
    <AppPanel title={t.ui.nav.activity} icon={LinkIcon} right={<ExampleTag />} bodyClassName="grid gap-3 p-4">
      <ol className="grid gap-1">
        {rows.map((e, i) => {
          const broken = tampered && e.id === TAMPERED;
          const ok = i < checked && !(broken && finished);
          const bad = broken && finished;
          return (
            <li key={e.id} className={cn("grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-[12px]", bad && "bg-[rgb(217_128_106/0.12)]")}>
              <span aria-hidden className="grid size-4 place-items-center">{bad ? <XIcon className="size-3.5 text-clay" strokeWidth={2.5} /> : ok ? <CheckIcon className="size-3.5 text-primary" strokeWidth={2.5} /> : <span className="size-1.5 rounded-full bg-border" />}</span>
              <span className="min-w-0 truncate">{agentOf(e.agent).name} · <span className="font-mono">{e.tool}.{ACTION[e.tool]}</span> · {broken ? <span className="font-medium text-clay">{t.timelinePage.outcome.allowed} ({c.tampered})</span> : t.timelinePage.outcome[e.outcome]}</span>
              <span className="hidden font-mono text-[11px] text-muted-foreground sm:block">#{e.hash}{i > 0 && ` ← #${rows[i - 1].hash}`}</span>
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className={cn("min-h-5 text-[13px] font-medium", finished && (tampered ? "text-clay" : "text-primary"))}>{finished ? (tampered ? c.broken(stopAt) : c.intact(rows.length)) : running ? c.checking : ""}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={running} onClick={() => { setChecked(0); setStarted(true); }} className={cn(buttonClass(), "h-9 px-3 text-[13px]")}>{running ? c.checking : c.check}</button>
        <button type="button" disabled={running} onClick={() => { setTampered((x) => !x); setChecked(0); setStarted(false); }} className={cn(buttonClass("secondary"), "h-9 px-3 text-[13px]")}>{tampered ? c.restore : c.tamper}</button>
      </div>
    </AppPanel>
  );
}

/** The last 24 hours: the app's numbers and a bar per hour. */
export function DayPanel() {
  const t = useT();
  const d = t.front.kit.day;
  const s = t.home.dash.stats;
  const max = Math.max(...DAY.ran.map((r, i) => r + DAY.waited[i] + DAY.blocked[i]));
  return (
    <AppPanel title={t.ui.nav.home} icon={ActivityIcon} right={<span>{d.hours}</span>} bodyClassName="grid gap-4 p-4">
      <StatsGrid stats={[{ label: d.ran, value: sum(DAY.ran), note: s.day }, { label: d.waited, value: sum(DAY.waited), note: s.day }, { label: d.blocked, value: sum(DAY.blocked), note: s.day }, { label: s.running, value: 3, note: s.of(4) }]} />
      <div role="img" aria-label={`${d.ran} ${sum(DAY.ran)}, ${d.waited} ${sum(DAY.waited)}, ${d.blocked} ${sum(DAY.blocked)} · ${d.hours}`}>
        <div aria-hidden className="flex h-28 items-end gap-[3px]">
          {DAY.ran.map((r, i) => {
            const all = r + DAY.waited[i] + DAY.blocked[i];
            return (
              <div key={i} className="flex flex-1 flex-col justify-end gap-px" style={{ height: `${Math.max(4, (all / max) * 100)}%` }}>
                {DAY.blocked[i] > 0 && <span className="rounded-[2px] bg-clay" style={{ flex: DAY.blocked[i] }} />}
                {DAY.waited[i] > 0 && <span className="rounded-[2px] bg-amber" style={{ flex: DAY.waited[i] }} />}
                <span className="rounded-[2px] bg-[#6f8f80]" style={{ flex: Math.max(r, all ? 0 : 1) }} />
              </div>
            );
          })}
        </div>
        <div aria-hidden className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>−24h</span><span>{d.now}</span></div>
        <div aria-hidden className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-[#6f8f80]" />{d.ran}</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-amber" />{d.waited}</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-clay" />{d.blocked}</span>
        </div>
      </div>
    </AppPanel>
  );
}

/** Three entries in small, each linked to the one before: for a card and the menu's preview. */
export function ActivityMini() {
  const t = useT();
  return (
    <AppPanel title={t.ui.nav.activity} icon={ActivityIcon} right={<span className="flex items-center gap-1"><LinkIcon className="size-3" strokeWidth={1.75} aria-hidden />#</span>}>
      <ul className="divide-y divide-border">
        {LOG.slice(2, 5).map((e) => (
          <li key={e.id} className="grid grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-[12px]">
            <span className="text-muted-foreground tabular-nums">{e.time}</span>
            <span className="min-w-0"><span className="block truncate font-mono text-[11px]">{e.tool}.{ACTION[e.tool]}</span><span className="block truncate text-[11px] text-muted-foreground">{agentOf(e.agent).name} · #{e.hash}</span></span>
            <OutcomeBadge outcome={e.outcome} className="h-5 text-[11px]" />
          </li>
        ))}
      </ul>
    </AppPanel>
  );
}
