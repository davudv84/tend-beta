"use client";

import { useMemo, useState } from "react";
import { InfoIcon } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipContentProps,
} from "recharts";
import { AgentSelect, PageHeader, Segmented, Stat, StatRow } from "@/components/kit";
import { useT } from "@/i18n/client";
import { daily, DAY, summarize } from "@/lib/derive";
import { shortDate, useNow } from "@/lib/format";
import { useStore } from "@/lib/store";

type Range = "7" | "14" | "30";

const AXIS = { stroke: "var(--border)", tick: { fill: "var(--faint)", fontSize: 11, fontFamily: "var(--font-geist-mono)" }, tickLine: false, axisLine: false } as const;

function Tip({ active, payload, label, pct = true }: Partial<TooltipContentProps> & { pct?: boolean }) {
  const t = useT();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-xl shadow-black/40">
      <p className="mb-1.5 font-mono text-faint">{shortDate(Number(label))}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-2 text-muted-foreground"><span className="size-1.5 rounded-full" style={{ background: p.color }} />{p.name}</span>
          <span className="font-mono tabular-nums">{p.value == null ? "—" : pct ? t.pct(String(p.value)) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

function ChartPanel({ title, definition, limits, children }: { title: string; definition: string; limits: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <section className="frame py-5">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-1 text-small leading-relaxed text-muted-foreground">{definition}</p>
      <div className="mt-5 -ml-2 h-[220px]">{children}</div>
      <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-faint"><span className="text-muted-foreground">{t.researchPage.limits}</span> {limits}</p>
    </section>
  );
}

export default function View() {
  const t = useT();
  const g = t.researchPage;
  const agents = useStore((s) => s.agents);
  const checkIns = useStore((s) => s.checkIns);
  const now = useNow();
  const [range, setRange] = useState<Range>("14");
  const [agent, setAgent] = useState("all");
  const days = Number(range);

  const { series, total, reporting } = useMemo(() => {
    const scoped = agent === "all" ? checkIns : checkIns.filter((c) => c.agentId === agent);
    const inRange = scoped.filter((c) => c.createdAt > now - days * DAY);
    return {
      series: daily(scoped, days, now),
      total: summarize(inRange),
      reporting: new Set(inRange.map((c) => c.agentId)).size,
    };
  }, [checkIns, agent, days, now]);

  const dec = (v: number) => v.toLocaleString(t.intl.date, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const perAgentDay = reporting ? dec(total.n / reporting / days) : "—";
  const fmt = (v: number | null, pct = true) => (v === null ? "—" : pct ? t.pct(v) : dec(v));
  const tickInterval = days > 14 ? 4 : days > 7 ? 1 : 0;

  return (
    <div>
      <PageHeader eyebrow={g.eyebrow} term={t.nav.items.research.term} title={g.title} description={g.description} />

      <aside className="mb-10 flex max-w-3xl gap-4 border-l border-sage/60 py-1 pl-5">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-sage" />
        <p className="text-sm leading-relaxed text-muted-foreground">
          {g.disclaimer}
          <span className="mt-1 block text-faint">{g.simulatedNote}</span>
        </p>
      </aside>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<Range> label={g.range} value={range} onChange={setRange}
          options={[{ value: "7", label: g.days(7) }, { value: "14", label: g.days(14) }, { value: "30", label: g.days(30) }]} />
        <AgentSelect value={agent} onChange={setAgent} />
      </div>

      <StatRow className="mb-6 md:grid-cols-3 lg:grid-cols-5">
        <Stat label={g.stats.consistency.label} value={fmt(total.instructions)} hint={g.stats.n(total.n)} info={g.stats.consistency.info} />
        <Stat label={g.stats.sufficiency.label} value={fmt(total.context)} hint={g.stats.n(total.n)} info={g.stats.sufficiency.info} />
        <Stat label={g.stats.uncertainty.label} value={fmt(total.uncertainty)} hint={g.stats.uncertainty.hint} info={g.stats.uncertainty.info} />
        <Stat label={g.stats.frequency.label} value={perAgentDay} hint={g.stats.frequency.hint} info={g.stats.frequency.info} />
        <Stat label={g.stats.intervention.label} value={fmt(total.intervention, false)} hint={g.stats.intervention.hint(total.decided)} info={g.stats.intervention.info} />
      </StatRow>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <ChartPanel {...g.charts.consistency}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
                <XAxis dataKey="t" tickFormatter={(t) => shortDate(t)} interval={tickInterval} {...AXIS} />
                <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v) => t.pct(v)} width={44} {...AXIS} />
                <Tooltip content={(p) => <Tip {...p} />} cursor={{ stroke: "var(--border)" }} />
                <Line isAnimationActive={false} type="monotone" dataKey="instructions" name={g.charts.consistency.a} stroke="var(--sage)" strokeWidth={1.75} dot={false} activeDot={{ r: 3 }} connectNulls />
                <Line isAnimationActive={false} type="monotone" dataKey="context" name={g.charts.consistency.b} stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </ChartPanel>
        </div>

        <ChartPanel {...g.charts.uncertainty}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="unc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--muted-foreground)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--muted-foreground)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
              <XAxis dataKey="t" tickFormatter={(t) => shortDate(t)} interval={tickInterval + 1} {...AXIS} />
              <YAxis domain={[0, 50]} ticks={[0, 25, 50]} tickFormatter={(v) => t.pct(v)} width={44} {...AXIS} />
              <Tooltip content={(p) => <Tip {...p} />} cursor={{ stroke: "var(--border)" }} />
              <Area isAnimationActive={false} type="monotone" dataKey="uncertainty" name={g.charts.uncertainty.a} stroke="var(--muted-foreground)" strokeWidth={1.5} fill="url(#unc)" connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel {...g.charts.frequency}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
              <XAxis dataKey="t" tickFormatter={(t) => shortDate(t)} interval={tickInterval + 1} {...AXIS} />
              <YAxis allowDecimals={false} width={44} {...AXIS} />
              <Tooltip content={(p) => <Tip {...p} pct={false} />} cursor={{ fill: "var(--elevated)" }} />
              <Bar isAnimationActive={false} dataKey="n" name={g.charts.frequency.a} fill="var(--chart-5)" activeBar={{ fill: "var(--muted-foreground)" }} radius={[3, 3, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <div className="lg:col-span-2">
          <ChartPanel {...g.charts.intervention}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
                <XAxis dataKey="t" tickFormatter={(t) => shortDate(t)} interval={tickInterval} {...AXIS} />
                <YAxis allowDecimals={false} width={44} {...AXIS} />
                <Tooltip content={(p) => <Tip {...p} pct={false} />} cursor={{ fill: "var(--elevated)" }} />
                <Bar isAnimationActive={false} dataKey="flagged" name={g.charts.intervention.a} fill="var(--amber)" fillOpacity={0.7} radius={[3, 3, 0, 0]} maxBarSize={14} />
                <Bar isAnimationActive={false} dataKey="decided" name={g.charts.intervention.b} fill="var(--foreground)" fillOpacity={0.7} radius={[3, 3, 0, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </ChartPanel>
        </div>
      </div>

      <section className="mt-12 grid gap-8 border-t border-border pt-10 md:grid-cols-3">
        <div>
          <h2 className="text-sm font-medium">{g.measure.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{g.measure.body}</p>
        </div>
        <div>
          <h2 className="text-sm font-medium">{g.claim.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{g.claim.body}</p>
        </div>
        <div>
          <h2 className="text-sm font-medium">{g.data.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{g.data.body(agents.filter((a) => a.origin === "demo").length, agents.filter((a) => a.origin === "connected").length)}</p>
        </div>
      </section>
    </div>
  );
}
