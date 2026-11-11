"use client";

import Link from "next/link";
import { useMemo } from "react";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { SignIn } from "@/components/sign-in";
import { useT } from "@/i18n/client";
import { byAction, outcomeOf, visibleAgent } from "@/lib/activity";
import { timeline } from "@/lib/derive";
import { useNow } from "@/lib/format";
import { homeQueue, orderAssistants, protectionOf, realAssistants } from "@/lib/home";
import { presenceOf } from "@/lib/protection";
import { useStore } from "@/lib/store";
import { AgentRow, lastRequest } from "@/ui/agent-row";
import { AnswerCard } from "@/ui/answer-card";
import { DecisionTable } from "@/ui/decision-table";
import { FirstRun } from "@/ui/first-run";
import { Page, PageSkeleton } from "@/ui/page";
import { Card, CardHeader, TextLink, buttonClass } from "@/ui/primitives";
import { useRuns } from "@/ui/use-runs";

const DAY = 86_400_000;
/** On Overview only the first few waiting requests are shown in full; the rest are one click away in Approvals. */
const SHOWN = 2;

/**
 * Overview answers three questions, in this order: does anything need me, what is running and what is it doing, and what happened.
 * Every number and line comes from recorded requests and agent presence; nothing is estimated or invented.
 */
export default function View() {
  const t = useT();
  const h = t.home;
  const d = h.dash;
  const ready = useStore((s) => s.ready);
  const status = useStore((s) => s.status);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const agents = useStore((s) => s.agents);
  const authorizations = useStore((s) => s.authorizations);
  const checkIns = useStore((s) => s.checkIns);
  const log = useStore((s) => s.log);
  const taskEvents = useStore((s) => s.taskEvents);
  const skew = useStore((s) => s.skew);
  const now = useNow() + skew;

  const real = useMemo(() => realAssistants(agents), [agents]);
  const runs = useRuns(useMemo(() => real.map((a) => a.id), [real]), ready && canAct);
  const queue = useMemo(() => homeQueue(agents, authorizations, now), [agents, authorizations, now]);
  const ordered = useMemo(() => orderAssistants(agents, runs, queue.waiting), [agents, runs, queue.waiting]);
  const events = useMemo(() => byAction(timeline(checkIns, log, taskEvents).filter(visibleAgent(agents, false)).filter((e) => e.kind !== "check_in" && e.kind !== "task" || outcomeOf(e))), [checkIns, log, taskEvents, agents]);

  if (status === "signin" || (ready && !canAct))
    return <Page><h1 className="text-section text-balance">{h.signedOut.title}</h1><p className="mt-4 max-w-[52ch] text-lead text-muted-foreground">{h.signedOut.body}</p><div className="mt-10 max-w-sm">{status === "signin" ? <SignIn compact /> : <Link href="/operator" className={buttonClass()}>{h.signedOut.action}</Link>}</div></Page>;
  if (!ready) return <PageSkeleton label={h.loading} />;
  if (real.length === 0) return <FirstRun title={h.headline.first} body={h.sub.first} sample={agents.length > 0} />;

  const mine = new Set(real.map((a) => a.id));
  const today = authorizations.filter((a) => mine.has(a.agentId) && a.createdAt > now - DAY);
  const running = real.filter((a) => a.status !== "paused" && a.integrationEnabled && presenceOf(a, now) === "running").length;
  const auto = today.filter((a) => a.reason === "policy_allowed").length;
  const blocked = today.filter((a) => a.status === "denied" || a.status === "rejected").length;
  const waiting = queue.waiting;
  // An agent whose checks found a problem is said in words on Overview, never only as a colour.
  const atRisk = real.filter((a) => protectionOf(a, runs.get(a.id)).state === "attention");
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const stats: [string, number, string, string?][] = [
    [d.stats.running, running, d.stats.of(real.length)],
    [d.stats.waiting, waiting.length, d.stats.now, waiting.length ? "/oversight" : undefined],
    [d.stats.auto, auto, d.stats.day],
    [d.stats.blocked, blocked, d.stats.day, blocked ? "/timeline" : undefined],
  ];

  return (
    <Page full>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em]">{t.ui.nav.home}</h1>
          <p className="mt-2 max-w-[60ch] text-[15px] text-pretty text-muted-foreground">{d.purpose}</p>
        </div>
        <Link href="/connect" className={buttonClass("secondary")}><PlusIcon className="size-4" strokeWidth={1.75} aria-hidden />{h.connect}</Link>
      </header>

      <p role="status" className={`mt-8 text-[17px] ${waiting.length ? "font-medium text-foreground" : "text-muted-foreground"}`}>{waiting.length ? d.needYou(waiting.length) : d.allQuiet}</p>
      {atRisk.length > 0 && (
        <p className="mt-2 text-[14px] text-clay">
          {t.protection.status.at_risk}: {atRisk.map((a) => <Link key={a.id} href={`/agents/${a.id}?tab=setup`} className="underline-offset-4 hover:underline">{a.name}</Link>)}
        </p>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
        {stats.map(([label, n, note, href]) => {
          const body = <><dt className="text-[13px] text-muted-foreground">{label}</dt><dd className="mt-2 text-[28px] leading-none font-medium tabular-nums">{n}</dd><dd className="mt-2 text-[13px] text-muted-foreground">{note}</dd></>;
          return href
            ? <Link key={label} href={href} className="bg-background px-5 py-4 outline-none transition-colors hover:bg-black/[0.025] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary dark:hover:bg-white/[0.04]"><div>{body}</div></Link>
            : <div key={label} className="bg-background px-5 py-4">{body}</div>;
        })}
      </dl>

      {waiting.length > 0 && (
        <section aria-labelledby="ov-needs" className="mt-10">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="ov-needs" className="text-[17px] font-medium">{d.needs}</h2>
            {waiting.length > SHOWN && <TextLink href="/oversight">{d.seeAll(waiting.length)}</TextLink>}
          </div>
          <ul className="mt-4 grid gap-4 lg:grid-cols-2">
            {waiting.slice(0, SHOWN).map((r) => (
              <li key={r.auth.id}><AnswerCard request={r} now={now} onAnswered={(_, answer) => toast.success(answer === "allowed" ? h.request.allowed : h.request.denied)} /></li>
            ))}
          </ul>
        </section>
      )}

      <Card className="mt-10">
        <CardHeader title={d.agents} right={<TextLink href="/agents">{h.overview.viewAgents}</TextLink>} />
        <ul className="divide-y divide-border border-t border-border">
          {ordered.map((a) => <AgentRow key={a.id} agent={a} run={runs.get(a.id)} now={now} last={lastRequest(authorizations, a.id)} />)}
        </ul>
        <footer className="border-t border-border px-5 py-3">
          <Link href="/connect" className="inline-flex items-center gap-2 text-[14px] text-muted-foreground transition-colors hover:text-foreground"><PlusIcon className="size-4" strokeWidth={1.75} aria-hidden />{d.add}</Link>
        </footer>
      </Card>

      <Card className="mt-10">
        <CardHeader title={h.recent.title} right={<TextLink href="/timeline">{h.recent.all}</TextLink>} />
        {events.length ? (
          <div className="border-t border-border"><DecisionTable events={events.slice(0, 6)} nameOf={nameOf} compact /></div>
        ) : <p className="border-t border-border px-6 py-5 text-[14px] text-muted-foreground">{h.recent.empty}</p>}
      </Card>

      <section aria-labelledby="ov-covers" className="mt-10 border-t border-border pt-6">
        <h2 id="ov-covers" className="text-[15px] font-medium">{d.covers.title}</h2>
        <p className="mt-2 max-w-[72ch] text-[14px] text-pretty text-muted-foreground">{d.covers.yes} {d.covers.no}</p>
        <TextLink href="/verification" className="mt-3 inline-block">{d.covers.link}</TextLink>
      </section>
    </Page>
  );
}
