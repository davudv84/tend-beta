"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { toast } from "sonner";
import { MessageSquareTextIcon, PauseIcon, PlayIcon } from "lucide-react";
import { Gated, useReadOnlyReason } from "@/components/agent-callout";
import { HOST_NAME, PresetPicker, ProtectionTest, hookOf } from "@/components/assistant-connect";
import { CheckInRow, Feed } from "@/components/feed";
import { ProtectionChecks } from "@/components/protection-checks";
import { ToolPermissions } from "@/components/tool-permissions";
import { SignIn } from "@/components/sign-in";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n";
import { DAY, summarize, timeline } from "@/lib/derive";
import { shortDate, useNow } from "@/lib/format";
import { useAgent, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { assistantStatus } from "@/ui/assistant-status";
import { Disclosure } from "@/ui/disclosure";
import { BackLink, Page, PageSkeleton, SectionHeader } from "@/ui/page";
import { useUiPrefs } from "@/ui/prefs-context";
import { useRuns } from "@/ui/use-runs";

export default function View() {
  const t = useT();
  const g = t.agentPage;
  const { id } = useParams<{ id: string }>();
  const agent = useAgent(id);
  const ready = useStore((s) => s.ready);
  const status = useStore((s) => s.status);
  const checkIns = useStore((s) => s.checkIns);
  const log = useStore((s) => s.log);
  const taskEvents = useStore((s) => s.taskEvents);
  const setPaused = useStore((s) => s.setPaused);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const skew = useStore((s) => s.skew);
  const readOnly = useReadOnlyReason();
  const [prefs] = useUiPrefs();
  const clock = useNow();
  const now = clock + skew;
  const runs = useRuns(useMemo(() => (agent ? [agent.id] : []), [agent]), ready && canAct && agent?.origin === "connected");

  const data = useMemo(() => {
    const mine = checkIns.filter((c) => c.agentId === id);
    const month = mine.filter((c) => c.createdAt > clock - 30 * DAY);
    return {
      mine,
      month: summarize(month),
      pending: mine.filter((c) => c.review?.status === "pending").length,
      events: timeline(mine.slice(0, 30), log.filter((l) => l.agentId === id), taskEvents.filter((t) => t.agentId === id)).slice(0, 12),
    };
  }, [checkIns, log, taskEvents, id, clock]);

  if (status === "signin") return <Page><SignIn compact /></Page>;
  if (!ready) return <PageSkeleton label={t.home.loading} />;
  if (!agent)
    return (
      <Page>
        <BackLink href="/agents" label={t.ui.nav.assistants} />
        <h1 className="mt-8 text-section text-balance">{g.notFound}</h1>
        <p className="mt-4 text-lead text-muted-foreground">{g.notFoundBody(id)}</p>
      </Page>
    );

  const paused = agent.status === "paused";
  const toggle = async () => {
    const r = await setPaused(agent.id, !paused);
    if (!r.ok) return toast.error(paused ? t.callout.toast.notResumed : t.callout.toast.notPaused, { description: errorText(t, r) });
    toast.success(paused ? g.resumed(agent.name) : g.paused(agent.name), {
      description: agent.origin === "connected" ? g.connectedNote : paused ? g.resumedSim : g.pausedSim,
    });
  };
  const { connection, line, second, attention } = assistantStatus(t, agent, runs.get(agent.id), now);
  const connected = agent.origin === "connected";
  const hook = hookOf(agent);
  const sectionClass = "mt-8 rounded-xl border border-border bg-background p-6";

  return (
    <Page wide>
      <BackLink href="/agents" label={t.ui.nav.assistants} />

      <header className="mt-8">
        <h1 className="text-section text-balance">{agent.name}</h1>
        {agent.role && <p className="mt-3 text-lead text-pretty text-muted-foreground">{agent.role}</p>}
        <div className="mt-6 flex items-start gap-3">
          <span aria-hidden className={cn("mt-[7px] size-2 shrink-0 rounded-full", connection === "connected" ? "bg-foreground" : "border border-faint")} />
          <div>
            <p className="text-ui">{line}</p>
            {second && (
              <p className={cn("text-small", attention ? "text-clay" : "text-muted-foreground")}>
                {connected && canAct ? <a href="#a-protection" className="underline-offset-4 hover:underline">{second}</a> : second}
              </p>
            )}
            {!connected && <p className="mt-1 text-small text-muted-foreground">{t.assistants.sample}</p>}
          </div>
        </div>
        <div className="mt-8 flex flex-wrap gap-2.5">
          <Gated allowed={canAct} reason={readOnly}>
            <Button variant="secondary" className="h-11 rounded-full border-border px-6 text-ui" onClick={toggle} disabled={!canAct || !agent.integrationEnabled}>
              {paused ? <><PlayIcon /> {g.resume}</> : <><PauseIcon /> {g.pause}</>}
            </Button>
          </Gated>
          <Link href={`/check-ins/new?agent=${agent.id}`} className="inline-flex h-11 items-center gap-2 rounded-full pr-3 text-ui text-muted-foreground transition-colors hover:text-foreground sm:pl-3"><MessageSquareTextIcon className="size-4" strokeWidth={1.75} aria-hidden /> {g.compose}</Link>
        </div>
      </header>

      {connected && canAct && hook && (
        <section id="a-assistant" aria-labelledby="a-assistant-title" className={cn(sectionClass, "scroll-mt-8")}>
          <SectionHeader id="a-assistant-title" title={t.assistant.protection.title} />
          <div className="mt-4 grid gap-8">
            <ProtectionTest key={agent.id} agent={agent} hostName={HOST_NAME[hook]} />
            <PresetPicker key={`p-${agent.id}`} agentId={agent.id} coverage={hook} />
          </div>
        </section>
      )}

      {connected && (
        <section aria-labelledby="a-tools" className={sectionClass}>
          <SectionHeader id="a-tools" title={t.tools.title} />
          <div className="mt-4">
            {canAct ? <ToolPermissions key={agent.id} agentId={agent.id} /> : <p className="text-small text-muted-foreground">{t.tools.readOnly}</p>}
          </div>
        </section>
      )}

      {connected && canAct && (
        <section id="a-protection" aria-labelledby="a-protection-title" className={cn(sectionClass, "scroll-mt-8")}>
          <SectionHeader id="a-protection-title" title={t.protection.title} />
          <div className="mt-4"><ProtectionChecks key={agent.id} agentId={agent.id} configVersion={agent.configVersion} /></div>
        </section>
      )}

      {(agent.permissions.length > 0 || !connected) && (
        <section aria-labelledby="a-permissions" className={sectionClass}>
          <SectionHeader id="a-permissions" title={g.permissions} />
          {agent.permissions.length ? (
            <ul className="mt-4 flex flex-wrap gap-2">
              {agent.permissions.map((p) => <li key={p} className="rounded-full bg-sunken px-3 py-1 font-mono text-caption text-muted-foreground">{p}</li>)}
            </ul>
          ) : <p className="mt-4 text-small text-muted-foreground">{t.common.noneGranted}</p>}
          <p className="mt-4 text-caption text-faint">
            {g.permissionsNote[0]} <Link href="/oversight" className="underline underline-offset-2 hover:text-muted-foreground">{t.nav.items.oversight.label}</Link>{g.permissionsNote[1]}
          </p>
        </section>
      )}

      <section aria-labelledby="a-activity" className={sectionClass}>
        <SectionHeader id="a-activity" title={t.nav.items.timeline.label} />
        <div className="mt-4"><Feed events={data.events} now={now} grouped /></div>
      </section>

      <Disclosure summary={g.recent} open={prefs.details} className="mt-12">
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 pt-3 text-small">
          <dt className="text-muted-foreground">{g.reports30}</dt><dd className="tabular-nums">{data.month.n}</dd>
          <dt className="text-muted-foreground">{g.consistency}</dt><dd className="tabular-nums">{data.month.instructions === null ? "—" : t.pct(data.month.instructions)}</dd>
          <dt className="text-muted-foreground">{g.sufficiency}</dt><dd className="tabular-nums">{data.month.context === null ? "—" : t.pct(data.month.context)}</dd>
          <dt className="text-muted-foreground">{g.pendingReviews}</dt>
          <dd className="tabular-nums">{data.pending ? <Link href="/oversight" className="text-primary underline-offset-4 hover:underline">{data.pending} · {g.awaitingHuman}</Link> : t.common.none}</dd>
        </dl>
        <div className="mt-4 divide-y divide-border">
          {data.mine.length ? data.mine.slice(0, 8).map((c) => <CheckInRow key={c.id} checkIn={c} now={now} showAgent={false} />) : <p className="py-2 text-small text-muted-foreground">{g.noReports}</p>}
        </div>
        {data.mine.length > 8 && <Link href={`/check-ins?agent=${agent.id}`} className="mt-3 inline-block text-small text-primary underline-offset-4 hover:underline">{g.viewAll(data.mine.length)}</Link>}
      </Disclosure>

      <Disclosure summary={g.details} open={prefs.details} className="mt-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2.5 pt-3 text-small">
          {agent.description && <><dt className="text-faint">{g.about}</dt><dd className="text-pretty">{agent.description}</dd></>}
          <dt className="text-faint">{g.model}</dt><dd>{agent.model}</dd>
          <dt className="text-faint">{g.provider}</dt><dd>{agent.provider}</dd>
          <dt className="text-faint">{g.connectedSince}</dt><dd>{shortDate(agent.connectedAt)}</dd>
          <dt className="text-faint">{g.access}</dt><dd>{agent.integrationEnabled ? g.accessOn(agent.origin === "demo") : g.accessOff}</dd>
          <dt className="text-faint">{g.id}</dt><dd className="font-mono text-caption break-all">{agent.id}</dd>
        </dl>
      </Disclosure>
    </Page>
  );
}
