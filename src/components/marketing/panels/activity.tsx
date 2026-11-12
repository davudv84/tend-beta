"use client";

import { useState } from "react";
import { ActivityIcon, ChevronDownIcon, ChevronRightIcon, LayoutGridIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { GROUPS, IN_GROUP, type Group } from "@/lib/activity";
import { cn } from "@/lib/utils";
import { DecisionRows } from "@/ui/decision-table";
import { StatsGrid } from "@/ui/stats-grid";
import { ACTIVITY, AGENT_LINES, OVERVIEW_STATS } from "../demo-data";
import { useActivityRows } from "../demo/parts";
import type { ActivityLine } from "../demo/use-demo";
import { AppPanel, ExampleTag, Terminal } from "../kit";
import { AUDIT_VERIFY } from "../site-data";

const LINES: ActivityLine[] = ACTIVITY.map((d, i) => ({ key: `a${i}`, time: d.time, agent: d.agent.name, detail: d.detail, action: `${d.tool}.${d.action}`, outcome: d.outcome, path: d.path, reason: { kind: "history", decision: d } }));

/**
 * Activity as the app's page draws it (app/(next)/timeline/view.tsx): the six groups, the agent picker and "More filters" above the
 * day's decisions, one row per action with the steps it took. The groups and the agent picker filter the sample rows as the app's do.
 */
export function ActivityPanel() {
  const t = useT();
  const g = t.timelinePage;
  const [group, setGroup] = useState<Group>("all");
  const [agent, setAgent] = useState("all");
  const all = useActivityRows(LINES);
  const rows = all.filter((r) => (group === "all" || (r.outcome && IN_GROUP[group].includes(r.outcome))) && (agent === "all" || r.agent === agent));
  return (
    <AppPanel title={g.title} icon={ActivityIcon} right={<><span className="hidden items-center gap-1.5 sm:flex"><span aria-hidden className="size-1.5 rounded-full bg-sage" />{g.live}</span><ExampleTag /></>} bodyClassName="p-0">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-6">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div role="radiogroup" aria-label={g.groupLabel} className="inline-flex rounded-full bg-sunken p-0.5">
            {GROUPS.map((v) => (
              <button key={v} type="button" role="radio" aria-checked={group === v} onClick={() => setGroup(v)} className={cn("h-8 rounded-full px-3.5 text-small whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50", group === v ? "bg-surface font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted-foreground hover:text-foreground")}>{g.groups[v]}</button>
            ))}
          </div>
        </div>
        <label className="relative w-full sm:w-48">
          <span className="sr-only">{t.common.agent}</span>
          <select value={agent} onChange={(e) => setAgent(e.target.value)} className="h-10 w-full appearance-none rounded-full border border-border bg-background pr-9 pl-4 text-small outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <option value="all">{t.common.allAgents}</option>
            {AGENT_LINES.map((l) => <option key={l.agent.id} value={l.agent.name}>{l.agent.name}</option>)}
          </select>
          <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        </label>
      </div>
      <p className="flex items-center gap-1 border-b border-border px-4 py-2.5 text-small text-muted-foreground md:px-6"><ChevronRightIcon className="size-3.5" aria-hidden />{g.moreFilters}</p>
      <h3 className="bg-sunken px-4 py-2 text-[13px] font-medium text-muted-foreground md:px-6">{t.time.today}</h3>
      <div aria-live="polite" className="border-t border-border">
        {rows.length ? <DecisionRows rows={rows} agents /> : (
          <div className="px-6 py-10 text-center"><p className="text-[15px] font-medium">{g.emptyTitle}</p><p className="mt-1 text-small text-muted-foreground">{g.emptyBody}</p></div>
        )}
      </div>
    </AppPanel>
  );
}

/** Checking the chain is a command, not a screen: the CLI's own output for `audit-verify` (scripts/tend-cli.mjs). */
export function ChainPanel() {
  return <Terminal {...AUDIT_VERIFY} minHeight={200} />;
}

/** The day at a glance is the four numbers on Overview (app/(next)/home), with the sample counts. */
export function DayPanel() {
  const t = useT();
  const s = t.home.dash.stats;
  return (
    <AppPanel title={t.ui.nav.home} icon={LayoutGridIcon} right={<ExampleTag />} bodyClassName="p-4">
      <StatsGrid className="lg:grid-cols-2" stats={[
        { label: s.running, value: OVERVIEW_STATS.running, note: s.of(OVERVIEW_STATS.agents) },
        { label: s.waiting, value: OVERVIEW_STATS.waiting, note: s.now },
        { label: s.auto, value: OVERVIEW_STATS.auto, note: s.day },
        { label: s.blocked, value: OVERVIEW_STATS.blocked, note: s.day },
      ]} />
    </AppPanel>
  );
}
