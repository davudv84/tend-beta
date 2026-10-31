"use client";

import { useMemo, useState } from "react";
import { Dot, Empty, Segmented } from "@/components/kit";
import { KIND_TONE, KINDS } from "@/components/feed";
import { AgentSelect } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n/client";
import { GROUPS, inGroup, visibleAgent, type Group } from "@/lib/activity";
import { timeline, type EventKind } from "@/lib/derive";
import { clock, dayLabel, useNow } from "@/lib/format";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { DecisionTable } from "@/ui/decision-table";
import { Disclosure } from "@/ui/disclosure";
import { Card } from "@/ui/primitives";

const PAGE = 40;

/** A chronological record: which assistant, what it tried, when, and how it ended. The detail filters stay one click away. */
export default function View() {
  const t = useT();
  const g = t.timelinePage;
  const agents = useStore((s) => s.agents);
  const checkIns = useStore((s) => s.checkIns);
  const log = useStore((s) => s.log);
  const taskEvents = useStore((s) => s.taskEvents);
  const status = useStore((s) => s.status);
  const syncedAt = useStore((s) => s.syncedAt);
  const now = useNow();
  const [group, setGroup] = useState<Group>("all");
  const [agent, setAgent] = useState("all");
  const [samples, setSamples] = useState(false);
  const [kinds, setKinds] = useState<Set<EventKind>>(() => new Set(KINDS));
  const [limit, setLimit] = useState(PAGE);

  const sampleCount = agents.filter((a) => a.origin !== "connected").length;
  const names = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);
  const name = (id: string) => names.get(id) ?? id;
  const all = useMemo(() => timeline(checkIns, log, taskEvents).filter(visibleAgent(agents, samples)), [checkIns, log, taskEvents, agents, samples]);
  const list = all.filter((e) => kinds.has(e.kind) && inGroup(e, group) && (agent === "all" || e.agentId === agent));
  const counts = useMemo(() => {
    const m = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<EventKind, number>;
    for (const e of all) if (agent === "all" || e.agentId === agent) m[e.kind]++;
    return m;
  }, [all, agent]);
  const toggle = (k: EventKind) => {
    setLimit(PAGE);
    setKinds((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const reset = () => { setGroup("all"); setAgent("all"); setKinds(new Set(KINDS)); setLimit(PAGE); };
  const visible = list.slice(0, limit);
  const byDay = visible.reduce<[string, typeof visible][]>((acc, e) => {
    const day = dayLabel(e.at, now);
    if (acc.at(-1)?.[0] === day) acc.at(-1)![1].push(e);
    else acc.push([day, [e]]);
    return acc;
  }, []);

  return (
    <>
      <h1 className="text-[40px] leading-[1.1] font-semibold tracking-[-0.03em]">{g.title}</h1>
      <p className="mt-3 max-w-[70ch] text-[15px] text-pretty text-muted-foreground">{g.description}</p>
      {/* The store follows the server's event stream; this says whether it is following right now, and when it last heard. */}
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted-foreground">
        <Dot tone={status === "live" ? "sage" : "amber"} pulse={status === "live"} />
        <span className="font-medium text-foreground">{status === "live" ? g.live : g.reconnecting}</span>
        <span>· {g.liveNote}</span>
        {syncedAt > 0 && <span className="text-faint">· {g.updated(clock(syncedAt))}</span>}
      </p>

      <Card className="mt-8">
        <div className="flex flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <Segmented value={group} onChange={(v) => { setGroup(v); setLimit(PAGE); }} label={g.groupLabel} options={GROUPS.map((v) => ({ value: v, label: g.groups[v] }))} />
          </div>
          <AgentSelect value={agent} onChange={(v) => { setAgent(v); setLimit(PAGE); }} />
        </div>
        <div className="border-t border-border px-6 py-2">
          <Disclosure summary={g.moreFilters}>
            <div className="grid gap-4 pt-3 pb-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label={g.filter}>
                {KINDS.map((k) => {
                  const on = kinds.has(k);
                  return (
                    <button key={k} type="button" aria-pressed={on} onClick={() => toggle(k)}
                      className={cn("inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-small transition-colors", on ? "border-border bg-sunken text-foreground" : "border-transparent text-faint hover:text-muted-foreground")}>
                      <Dot tone={KIND_TONE[k]} className={cn(!on && "opacity-40")} />
                      {t.kindLabel[k]}
                      <span className="text-caption tabular-nums text-faint">{counts[k]}</span>
                    </button>
                  );
                })}
              </div>
              {sampleCount > 0 && (
                <label className="flex items-center gap-2.5 text-small text-muted-foreground">
                  <Switch checked={samples} onCheckedChange={(v) => { setSamples(v); setLimit(PAGE); }} aria-label={g.samples} />
                  {g.samples} ({sampleCount})
                </label>
              )}
            </div>
          </Disclosure>
        </div>
        {visible.length ? (
          byDay.map(([day, events]) => (
            <section key={day} aria-label={day} className="border-t border-border">
              <h2 className="bg-[#fafafa] px-6 py-2 text-[13px] font-medium text-muted-foreground dark:bg-sunken">{day}</h2>
              <DecisionTable events={events} nameOf={name} />
            </section>
          ))
        ) : (
          <div className="border-t border-border"><Empty title={g.emptyTitle} body={g.emptyBody} action={<Button variant="secondary" className="h-10 border-border px-5 text-small" onClick={reset}>{g.reset}</Button>} /></div>
        )}
        {list.length > limit && (
          <div className="border-t border-border px-6 py-3">
            <Button variant="ghost" className="-ml-3 h-10 px-4 text-small" onClick={() => setLimit((l) => l + PAGE)}>{g.earlier} ({g.more(list.length - limit)})</Button>
          </div>
        )}
      </Card>
    </>
  );
}
