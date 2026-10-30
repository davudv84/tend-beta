"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SignIn } from "@/components/sign-in";
import { useT } from "@/i18n/client";
import { outcomeOf, visibleAgent } from "@/lib/activity";
import { timeline } from "@/lib/derive";
import { clock, timeAgo, useNow } from "@/lib/format";
import { connectionOf, homeQueue, protectionOf, realAssistants } from "@/lib/home";
import { presenceOf } from "@/lib/protection";
import { useStore } from "@/lib/store";
import type { CheckGroup, CheckStatus } from "@/lib/verification";
import { AgentRow } from "@/ui/agent-row";
import { DecisionTable } from "@/ui/decision-table";
import { FirstRun } from "@/ui/first-run";
import { Page, PageSkeleton } from "@/ui/page";
import { Badge, Card, CardHeader, SegmentBar, TextLink, buttonClass, type Tone } from "@/ui/primitives";
import { useRunsWithReload } from "@/ui/use-runs";

const DAY = 86_400_000;
const GROUPS: CheckGroup[] = ["live", "isolated", "outside"];

/** Overview: the current state of Tend, from real data only. Nothing here is estimated or invented. */
export default function View() {
  const t = useT();
  const h = t.home;
  const ready = useStore((s) => s.ready);
  const status = useStore((s) => s.status);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const agents = useStore((s) => s.agents);
  const authorizations = useStore((s) => s.authorizations);
  const checkIns = useStore((s) => s.checkIns);
  const log = useStore((s) => s.log);
  const taskEvents = useStore((s) => s.taskEvents);
  const runVerification = useStore((s) => s.runVerification);
  const skew = useStore((s) => s.skew);
  const now = useNow() + skew;
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<"all" | "held" | "blocked">("all");

  const real = useMemo(() => realAssistants(agents), [agents]);
  const { runs, reload } = useRunsWithReload(useMemo(() => real.map((a) => a.id), [real]), ready && canAct);
  const queue = useMemo(() => homeQueue(agents, authorizations, now), [agents, authorizations, now]);
  const events = useMemo(() => timeline(checkIns, log, taskEvents).filter(visibleAgent(agents, false)).filter((e) => e.kind !== "check_in" && e.kind !== "task" || outcomeOf(e)), [checkIns, log, taskEvents, agents]);

  if (status === "signin" || (ready && !canAct))
    return <Page><h1 className="text-section text-balance">{h.signedOut.title}</h1><p className="mt-4 max-w-[52ch] text-lead text-muted-foreground">{h.signedOut.body}</p><div className="mt-10 max-w-sm">{status === "signin" ? <SignIn compact /> : <Link href="/operator" className={buttonClass()}>{h.signedOut.action}</Link>}</div></Page>;
  if (!ready) return <PageSkeleton label={h.loading} />;
  if (real.length === 0) return <FirstRun title={h.headline.first} body={h.sub.first} sample={agents.length > 0} />;

  // ---- the numbers, each from a named source ----
  // Running means TEND heard from it in the last few minutes (src/lib/protection.ts); registered alone is not running.
  const connected = real.filter((a) => connectionOf(a, now) !== "paused" && connectionOf(a, now) !== "disabled" && presenceOf(a, now) === "running");
  const offline = real.filter((a) => !connected.includes(a));
  const waiting = queue.waiting;
  const oldest = waiting.length ? Math.max(...waiting.map((r) => Math.floor((now - r.auth.createdAt) / 60_000))) : 0;
  const blocked = authorizations.filter((a) => a.createdAt > now - DAY && (a.status === "denied" || a.status === "rejected") && real.some((x) => x.id === a.agentId));
  const reasonCount = (r: string) => blocked.filter((a) => a.status === "denied" && a.reason === r).length;
  const rejected = blocked.filter((a) => a.status === "rejected").length;
  const ranList = real.map((a) => protectionOf(a, runs.get(a.id)));
  const checkedAgents = ranList.filter((p) => p.state === "ran" || p.state === "attention");
  const clean = ranList.filter((p) => p.state === "ran").length;
  const atRiskAgents = ranList.filter((p) => p.state === "attention").length;
  const lastRun = [...runs.values()].filter(Boolean).reduce((m, r) => Math.max(m, r!.at), 0);
  const tone: Tone = atRiskAgents > 0 || queue.floods.length > 0 ? "attention" : checkedAgents.length === real.length ? "good" : "neutral";
  const headline = atRiskAgents > 0 || queue.floods.length > 0 ? h.overview.attention : checkedAgents.length === real.length ? h.overview.allChecked : checkedAgents.length > 0 ? h.overview.someChecked : h.overview.noChecks;

  const groupCounts = GROUPS.map((g) => {
    const c: Record<CheckStatus, number> = { verified: 0, at_risk: 0, not_verified: 0 };
    for (const r of runs.values()) for (const k of r?.checks ?? []) if (k.group === g) c[k.status]++;
    return [g, c] as const;
  });
  const rows = events.filter((e) => filter === "all" || (filter === "held" ? outcomeOf(e) === "needs_approval" : ["blocked", "rejected"].includes(outcomeOf(e) ?? ""))).slice(0, 6);
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const runAll = async () => {
    setRunning(true);
    for (const a of connected) await runVerification(a.id);
    setRunning(false);
    reload();
  };

  return (
    <Page full>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-[40px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance">{t.ui.nav.home}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] text-muted-foreground">
            <Badge tone={tone}>{headline}</Badge>
            <span>{h.overview.summary(clean + atRiskAgents, real.length)}{lastRun ? ` ${h.overview.evaluated(clock(lastRun))}` : ""}</span>
          </p>
        </div>
        <button type="button" onClick={() => void runAll()} disabled={running || connected.length === 0} className={buttonClass()}>{running ? h.overview.running : h.overview.run}</button>
      </header>

      <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
        <div className="bg-background px-8 py-6">
          <p className="text-[14px] text-muted-foreground">{h.overview.connected}</p>
          <p className="mt-3 flex items-baseline gap-2"><span className="text-[44px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{connected.length}</span><span className="text-[18px] text-muted-foreground">{h.overview.of(real.length)}</span></p>
          <p className="mt-4 text-[14px] text-muted-foreground">{offline.length ? h.overview.offline(offline.map((a) => a.name).slice(0, 2).join(", "), offline.length) : h.overview.allConnected}</p>
        </div>
        <div className="bg-background px-8 py-6">
          <p className="text-[14px] text-muted-foreground">{h.overview.pending}</p>
          <p className="mt-3 flex items-baseline justify-between gap-2"><span className="flex items-baseline gap-2"><span className="text-[44px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{waiting.length}</span><span className="text-[18px] text-muted-foreground">{h.overview.waiting}</span></span><TextLink href="/oversight">{h.overview.review}</TextLink></p>
          <p className="mt-4 text-[14px] text-muted-foreground">{waiting.length ? h.overview.oldest(oldest) : h.overview.noneWaiting}</p>
        </div>
        <div className="bg-background px-8 py-6">
          <p className="text-[14px] text-muted-foreground">{h.overview.blocked}</p>
          <p className="mt-3 flex items-baseline justify-between gap-2"><span className="flex items-baseline gap-2"><span className="text-[44px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{blocked.length}</span><span className="text-[18px] text-muted-foreground">{h.overview.blockedWord}</span></span><TextLink href="/timeline">{h.overview.details}</TextLink></p>
          <p className="mt-4 text-[14px] text-muted-foreground">{blocked.length ? h.overview.breakdown(reasonCount("no_policy"), reasonCount("policy_denied"), rejected, blocked.length - reasonCount("no_policy") - reasonCount("policy_denied") - rejected) : h.overview.noneBlocked}</p>
        </div>
      </div>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={h.overview.agentsTitle} right={h.overview.of2(connected.length, real.length)} />
          <ul className="divide-y divide-border border-t border-border">
            {real.map((a) => <AgentRow key={a.id} agent={a} run={runs.get(a.id)} now={now} />)}
          </ul>
          <footer className="border-t border-border px-6 py-4"><TextLink href="/agents">{h.overview.viewAgents}</TextLink></footer>
        </Card>

        <div className="grid gap-8">
          <Card>
            <CardHeader title={h.overview.pendingTitle} sub={h.overview.pendingSub} />
            {waiting.length ? (
              <ul className="divide-y divide-border border-t border-border">
                {waiting.slice(0, 3).map((r) => (
                  <li key={r.auth.id} className="flex items-center justify-between gap-4 px-6 py-4">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[14px] font-medium">{r.auth.tool}.{r.auth.action}</p>
                      <p className="truncate text-[14px] text-muted-foreground">{r.auth.detail ?? r.auth.resource ?? ""}</p>
                      <p className="mt-1 text-[13px] text-muted-foreground">{r.agent.name} · {timeAgo(r.auth.createdAt, now)}</p>
                    </div>
                    <Link href="/oversight" className={buttonClass("secondary")}>{h.overview.reviewBtn}</Link>
                  </li>
                ))}
              </ul>
            ) : <p className="border-t border-border px-6 py-5 text-[14px] text-muted-foreground">{h.overview.noneWaiting}</p>}
          </Card>

          <Card>
            <CardHeader title={h.overview.verifyTitle} right={lastRun ? h.overview.checkedAt(clock(lastRun)) : undefined} />
            <div className="divide-y divide-border border-t border-border">
              {groupCounts.map(([g, c]) => (
                <div key={g} className="px-6 py-4">
                  <p className="text-[15px] font-medium">{t.protection.groups[g].title}</p>
                  <div className="mt-2"><SegmentBar verified={c.verified} atRisk={c.at_risk} notVerified={c.not_verified} /></div>
                  <p className="mt-2 text-[13px] text-muted-foreground">{h.overview.counts(c.verified, c.at_risk, c.not_verified)}</p>
                </div>
              ))}
            </div>
            <footer className="border-t border-border px-6 py-4 text-[13px] text-pretty text-muted-foreground">
              {h.overview.verifyNote} <span className="sr-only">{t.protection.status.at_risk}</span><Link href="/verification" className="font-medium text-primary hover:underline">{h.overview.scope}</Link>
            </footer>
          </Card>
        </div>
      </div>

      <Card className="mt-8">
        <CardHeader title={h.recent.title} sub={h.overview.activitySub(events.filter((e) => outcomeOf(e) === "allowed" || outcomeOf(e) === "ran").length, events.filter((e) => outcomeOf(e) === "blocked" || outcomeOf(e) === "rejected").length, events.filter((e) => outcomeOf(e) === "needs_approval").length)}
          right={<span className="flex items-center gap-4">
            <span role="group" aria-label={h.overview.filterLabel} className="inline-flex rounded-lg border border-border bg-[#fafafa] p-0.5">
              {(["all", "held", "blocked"] as const).map((k) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`h-7 rounded-md px-3 text-[13px] ${filter === k ? "border border-border bg-background font-medium text-foreground" : "text-muted-foreground"}`}>{h.overview.filters[k]}</button>)}
            </span>
            <TextLink href="/timeline">{h.recent.all.replace(/^See /, "View ")}</TextLink>
          </span>} />
        {rows.length ? (
          <div className="border-t border-border"><DecisionTable events={rows} nameOf={nameOf} compact /></div>
        ) : <p className="border-t border-border px-6 py-5 text-[14px] text-muted-foreground">{h.recent.empty}</p>}
      </Card>
    </Page>
  );
}
