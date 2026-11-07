"use client";

import { PlusIcon } from "lucide-react";
import { IntegrationLogo } from "@/components/integration-logo";
import { useT } from "@/i18n/client";
import { INTEGRATIONS } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import { Card, CardHeader, buttonClass } from "@/ui/primitives";
import { ACTIVITY, AGENT_LINES, INVOICE_REQUEST, OPS_AGENT, OVERVIEW_STATS, PUSH_REQUEST, REPO_HELPER, type DemoAgentLine } from "../demo-data";
import { AppShell } from "./app-shell";
import { DecisionRows, DemoRequestCard } from "./approvals-screen";

/**
 * The Overview screen as the app shows it (app/(next)/home/view.tsx), top to bottom: the four numbers, the two requests that need an
 * answer, the agents and what each is doing, the recent activity, and what TEND covers.
 */
export function OverviewScreen() {
  const t = useT();
  const h = t.home;
  const d = h.dash;
  const s = OVERVIEW_STATS;
  const stats: [string, number, string][] = [
    [d.stats.running, s.running, d.stats.of(s.agents)],
    [d.stats.waiting, s.waiting, d.stats.now],
    [d.stats.auto, s.auto, d.stats.day],
    [d.stats.blocked, s.blocked, d.stats.day],
  ];
  const more = (text: string) => <span className="text-[14px] font-medium text-primary">{text} →</span>;
  return (
    <AppShell active="home" waiting={s.waiting} online={s.running}>
      <div className="mx-auto w-full max-w-[1180px] px-12 pt-14 pb-12">
        <header className="flex items-end justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em]">{t.ui.nav.home}</h1>
            <p className="mt-2 max-w-[60ch] text-[15px] text-pretty text-muted-foreground">{d.purpose}</p>
          </div>
          <span className={buttonClass("secondary")}><PlusIcon className="size-4" strokeWidth={1.75} />{h.connect}</span>
        </header>

        <p className="mt-8 text-[17px] font-medium text-foreground">{d.needYou(s.waiting)}</p>

        <dl className="mt-6 grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-border bg-border">
          {stats.map(([label, n, note]) => (
            <div key={label} className="bg-background px-5 py-4">
              <dt className="text-[13px] text-muted-foreground">{label}</dt>
              <dd className="mt-2 text-[28px] leading-none font-medium tabular-nums">{n}</dd>
              <dd className="mt-2 text-[13px] text-muted-foreground">{note}</dd>
            </div>
          ))}
        </dl>

        <section className="mt-10">
          <h2 className="text-[17px] font-medium">{d.needs}</h2>
          <ul className="mt-4 grid grid-cols-2 gap-4">
            <li><DemoRequestCard request={INVOICE_REQUEST} agentName={OPS_AGENT.name} /></li>
            <li><DemoRequestCard request={PUSH_REQUEST} agentName={REPO_HELPER.name} /></li>
          </ul>
        </section>

        <Card className="mt-10">
          <CardHeader title={d.agents} right={more(h.overview.viewAgents)} />
          <ul className="divide-y divide-border border-t border-border">{AGENT_LINES.map((a) => <AgentLine key={a.agent.id} line={a} />)}</ul>
          <footer className="border-t border-border px-5 py-3">
            <span className="inline-flex items-center gap-2 text-[14px] text-muted-foreground"><PlusIcon className="size-4" strokeWidth={1.75} />{d.add}</span>
          </footer>
        </Card>

        <Card className="mt-10">
          <CardHeader title={h.recent.title} right={more(h.recent.all)} />
          <div className="border-t border-border"><DecisionRows rows={ACTIVITY.slice(0, 5)} compact /></div>
        </Card>

        <section className="mt-10 border-t border-border pt-6">
          <h2 className="text-[15px] font-medium">{d.covers.title}</h2>
          <p className="mt-2 max-w-[72ch] text-[14px] text-pretty text-muted-foreground">{d.covers.yes} {d.covers.no}</p>
          <span className="mt-3 inline-block">{more(d.covers.link)}</span>
        </section>
      </div>
    </AppShell>
  );
}

/** One agent in a line, as ui/agent-row.tsx draws it: its mark and name, whether it is active, and its latest request. */
function AgentLine({ line: a }: { line: DemoAgentLine }) {
  const t = useT();
  const d = t.home.dash;
  const entry = INTEGRATIONS.find((i) => i.id === a.integration) ?? { logo: undefined, category: "agent" as const };
  const prefix = a.doing ? d.doing[a.doing] : "";
  return (
    <li className="flex items-center gap-4 px-5 py-4">
      <IntegrationLogo entry={entry} className="size-9" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-x-3">
          <span className="truncate text-[15px] font-medium">{a.agent.name}</span>
          <span className={cn("inline-flex items-center gap-1.5 text-[13px]", a.live ? "text-foreground" : "text-muted-foreground")}>
            <span className={cn("size-1.5 rounded-full", a.live ? "bg-primary" : "border border-muted-foreground")} />
            {a.live ? d.word.active : d.word.idle}
          </span>
        </span>
        <span className={cn("mt-0.5 block truncate font-mono text-[13px]", a.doing === "waiting" ? "text-foreground" : "text-muted-foreground")}>
          {prefix && <span className="font-sans text-[14px]">{prefix}: </span>}{a.detail}
        </span>
      </span>
      <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">{t.time.ago(a.minutesAgo, "m")}</span>
    </li>
  );
}
