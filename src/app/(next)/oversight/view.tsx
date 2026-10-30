"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AgentSelect, Dot, Empty, PageHeader } from "@/components/kit";
import { Gated, useReadOnlyReason } from "@/components/agent-callout";
import { shownStatus } from "@/components/authorizations";
import { ConnectedAgents } from "@/components/connected-agents";
import { RequestCard, ReviewCard } from "@/components/review";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Disclosure } from "@/ui/disclosure";
import { assistantStatus } from "@/ui/assistant-status";
import { homeQueue, realAssistants } from "@/lib/home";
import { clock } from "@/lib/format";
import { AnswerCard } from "@/ui/answer-card";
import { Badge, Card } from "@/ui/primitives";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n";
import { KIND_TONE, sentence } from "@/components/feed";
import { logEvent } from "@/lib/derive";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dateTime, eventHref, useNow } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Agent } from "@/lib/types";

export default function View() {
  const t = useT();
  const g = t.oversightPage;
  const agents = useStore((s) => s.agents);
  const checkIns = useStore((s) => s.checkIns);
  const log = useStore((s) => s.log);
  const setPaused = useStore((s) => s.setPaused);
  const setIntegration = useStore((s) => s.setIntegration);
  const requests = useStore((s) => s.requests);
  const authorizations = useStore((s) => s.authorizations);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const skew = useStore((s) => s.skew);
  const readOnly = useReadOnlyReason();
  const now = useNow() + skew;
  const [busy, setBusy] = useState<string | null>(null);
  const [logAgent, setLogAgent] = useState("all");
  const [logLimit, setLogLimit] = useState(30);
  const [disabling, setDisabling] = useState<Agent | null>(null);
  const [samples, setSamples] = useState(false);
  // A notification links here with ?request=<id>: that request is scrolled to and marked. Answering it still goes through its own card.
  const asked = useSearchParams().get("request");
  const focus = asked && /^az_[a-f0-9]{24}$/.test(asked) ? asked : null;

  // Like Home, this screen is about real assistants; invented sample assistants are opt-in.
  const pool = useMemo(() => (samples ? agents : realAssistants(agents)), [agents, samples]);
  const sampleCount = agents.length - realAssistants(agents).length;
  const inPool = useMemo(() => new Set(pool.map((a) => a.id)), [pool]);
  const inPoolIds = inPool;
  const queue = useMemo(() => homeQueue(agents, authorizations, now), [agents, authorizations, now]);
  const history = useMemo(() => authorizations.filter((a) => a.status !== "pending" && inPoolIds.has(a.agentId)).sort((x, y) => (y.decidedAt ?? y.createdAt) - (x.decidedAt ?? x.createdAt)).slice(0, 15), [authorizations, inPoolIds]);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  // Check-ins and standalone requests, newest first.
  const pending = useMemo(
    () => [...checkIns.filter((c) => c.review?.status === "pending" && inPool.has(c.agentId)), ...requests.filter((r) => r.review.status === "pending" && inPool.has(r.agentId))].sort((a, b) => b.createdAt - a.createdAt),
    [checkIns, requests, inPool],
  );
  const pendingAuth = authorizations.filter((a) => shownStatus(a, now) === "pending").length;
  const entries = log.filter((l) => inPool.has(l.agentId) && (logAgent === "all" || l.agentId === logAgent));

  const confirmText = (a: Agent) => (a.origin === "connected" ? g.connectedNote : g.recorded);
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const pause = async (a: Agent, paused: boolean) => {
    setBusy(a.id);
    const r = await setPaused(a.id, paused);
    setBusy(null);
    if (!r.ok) return toast.error(paused ? g.notPaused(a.name) : g.notResumed(a.name), { description: errorText(t, r) });
    toast.success(paused ? g.paused(a.name) : g.resumed(a.name), { description: confirmText(a) });
  };
  const integration = async (a: Agent, enabled: boolean) => {
    setBusy(a.id);
    const r = await setIntegration(a.id, enabled);
    setBusy(null);
    if (!r.ok) return toast.error(g.accessFailed, { description: errorText(t, r) });
    toast.success(enabled ? g.accessOn(a.name) : g.accessOff(a.name), { description: confirmText(a) });
  };

  return (
    <div>
      <PageHeader title={g.title} description={g.description} />

      <Tabs defaultValue="authorizations">
        <TabsList variant="line" className="mb-8 h-auto! w-full justify-start gap-6 overflow-x-auto rounded-none border-b border-border p-0 pb-[3px] text-ui">
          <TabsTrigger value="authorizations" className="flex-none px-0">
            {g.tabs.authorizations} {pendingAuth > 0 && <span className="text-caption tabular-nums text-muted-foreground">{pendingAuth}</span>}
          </TabsTrigger>
          <TabsTrigger value="queue" className="flex-none px-0">
            {g.tabs.queue} {pending.length > 0 && <span className="text-caption tabular-nums text-muted-foreground">{pending.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="log" className="flex-none px-0">{g.tabs.log}</TabsTrigger>
          <TabsTrigger value="controls" className="flex-none px-0">{g.tabs.controls}</TabsTrigger>
          <TabsTrigger value="integrations" className="flex-none px-0">{g.tabs.connected}</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="grid gap-4">
          {pending.length ? (
            pending.map((c) =>
              "responses" in c ? <ReviewCard key={c.id} checkIn={c} agent={byId.get(c.agentId)!} now={now} /> : <RequestCard key={c.id} request={c} agent={byId.get(c.agentId)!} now={now} />,
            )
          ) : (
            <Empty title={g.queueEmpty} body={g.queueEmptyBody} />
          )}
        </TabsContent>

        <TabsContent value="authorizations" className="grid gap-8">
          <section aria-labelledby="ap-wait">
            <h2 id="ap-wait" className="text-[17px] font-semibold">{g.waitingTitle}</h2>
            <p className="mt-1 text-[14px] text-muted-foreground">{g.waitingSub}</p>
            {focus && !queue.waiting.some((r) => r.auth.id === focus) && <p role="status" className="mt-4 rounded-lg border border-border bg-sunken/60 px-4 py-3 text-[14px] text-muted-foreground">{g.requestGone}</p>}
            {queue.waiting.length ? (
              <ul className="mt-4 grid gap-4">{queue.waiting.map((r) => (
                <li key={r.auth.id} id={`request-${r.auth.id}`} ref={r.auth.id === focus ? (el) => el?.scrollIntoView({ block: "center" }) : undefined}
                  className={r.auth.id === focus ? "rounded-xl outline-2 outline-offset-4 outline-primary" : undefined}>
                  <AnswerCard request={r} now={now} onAnswered={() => undefined} />
                </li>
              ))}</ul>
            ) : <Card className="mt-4"><p className="px-6 py-8 text-center text-[14px] text-muted-foreground">{g.nothingWaiting}</p></Card>}
          </section>
          <section aria-labelledby="ap-hist">
            <h2 id="ap-hist" className="text-[17px] font-semibold">{g.historyTitle}</h2>
            <Card className="mt-4">
              {history.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-[14px]">
                    <thead className="bg-[#fafafa] text-[13px] text-muted-foreground dark:bg-sunken"><tr>{t.home.overview.columns.map((c) => <th key={c} scope="col" className="px-6 py-3 font-normal">{c}</th>)}</tr></thead>
                    <tbody className="divide-y divide-border">
                      {history.map((a) => {
                        const o = a.status === "consumed" ? "ran" : a.status === "denied" ? "blocked" : a.status === "cancelled" ? "withdrawn" : a.status;
                        return (
                          <tr key={a.id}>
                            <td className="px-6 py-3.5 whitespace-nowrap text-muted-foreground tabular-nums">{clock(a.decidedAt ?? a.createdAt)}</td>
                            <td className="px-6 py-3.5 font-medium">{nameOf(a.agentId)}</td>
                            <td className="px-6 py-3.5 font-mono text-[13px]">{a.tool}.{a.action}</td>
                            <td className="px-6 py-3.5"><Badge tone={o === "blocked" || o === "rejected" ? "danger" : "neutral"}>{t.timelinePage.outcome[o as keyof typeof t.timelinePage.outcome] ?? a.status}</Badge></td>
                            <td className="px-6 py-3.5 text-muted-foreground">{a.reason ? t.timelinePage.reasons[a.reason] ?? a.reason : ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <p className="px-6 py-8 text-center text-[14px] text-muted-foreground">{g.noHistory}</p>}
            </Card>
          </section>
        </TabsContent>

        <TabsContent value="controls">
          <ul>
            {pool.map((a) => {
              const st = assistantStatus(t, a, undefined, now);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
                  <Link href={`/agents/${a.id}`} className="min-w-0 flex-1 basis-56 rounded-md">
                    <span className="block text-ui font-medium hover:underline">{a.name}</span>
                    <span className="block text-small text-muted-foreground">{st.line}</span>
                  </Link>
                  <Gated allowed={canAct} reason={readOnly}>
                    <label className="flex items-center gap-2.5 text-small text-muted-foreground">
                      <Switch checked={a.status !== "paused"} disabled={!canAct || !a.integrationEnabled || busy === a.id} onCheckedChange={(v) => pause(a, !v)} aria-label={g.runningLabel(a.name)} />
                      {g.columns.running}
                    </label>
                  </Gated>
                  <Gated allowed={canAct} reason={readOnly}>
                    <label className="flex items-center gap-2.5 text-small text-muted-foreground">
                      <Switch checked={a.integrationEnabled} disabled={!canAct || busy === a.id} onCheckedChange={(v) => (v ? integration(a, true) : setDisabling(a))} aria-label={g.accessLabel(a.name)} />
                      {g.columns.access}
                    </label>
                  </Gated>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-caption text-faint">{g.controlsNote}</p>

          <AlertDialog open={!!disabling} onOpenChange={(o) => !o && setDisabling(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{g.disableTitle(disabling?.name ?? "")}</AlertDialogTitle>
                <AlertDialogDescription>{g.disableBody(disabling?.name ?? "")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => disabling && integration(disabling, false)}>{g.disable}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        <TabsContent value="log">
          <div className="mb-4 flex items-center justify-between gap-4">
            <p className="text-small text-faint">{g.logNote}</p>
            <AgentSelect value={logAgent} onChange={(v) => { setLogAgent(v); setLogLimit(30); }} />
          </div>
          <div>
            {entries.length ? (
              <ol className="divide-y divide-border font-mono text-caption">
                {entries.slice(0, logLimit).map((l) => {
                  const ev = logEvent(l);
                  const { subject, predicate } = sentence(t, ev, nameOf);
                  // Alerts carry the timeline's amber dot; a withdrawal the muted one. Other rows keep the slot empty so columns align.
                  const marked = ev.kind === "alert" || l.type === "review_withdrawn";
                  const cells = (
                    <>
                      <time className="text-faint tabular-nums">{dateTime(l.at)}</time>
                      <span className="flex items-center gap-2 self-start text-faint">
                        <Dot tone={ev.kind === "alert" ? KIND_TONE.alert : "muted"} className={marked ? undefined : "invisible"} />
                        {g.actor[l.actor]}
                      </span>
                      <span className="min-w-0 font-sans text-sm text-muted-foreground">
                        <span className="text-foreground">{subject} {predicate}</span>
                        {l.note && <span className="mt-0.5 block text-small text-faint">{t.quote(l.note)}</span>}
                      </span>
                    </>
                  );
                  const grid = "grid gap-x-6 gap-y-1 px-5 py-3 md:grid-cols-[9rem_6rem_minmax(0,1fr)]";
                  return (
                    <li key={l.id}>
                      {l.eventId ? <Link href={eventHref(l.eventId)} className={`${grid} transition-colors hover:bg-elevated/60`}>{cells}</Link> : <div className={grid}>{cells}</div>}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <Empty title={g.logEmpty} />
            )}
            {entries.length > logLimit && (
              <div className="border-t border-border p-3">
                <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setLogLimit((n) => n + 30)}>{g.older}</Button>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="integrations">
          <ConnectedAgents />
        </TabsContent>
      </Tabs>

      {sampleCount > 0 && (
        <label className="mt-12 flex items-center gap-2.5 text-small text-muted-foreground">
          <Switch checked={samples} onCheckedChange={setSamples} aria-label={g.samples} />
          {g.samples} ({sampleCount})
        </label>
      )}
      <Disclosure summary={g.howTitle} className="mt-6">
        <ul className="grid gap-4 pt-3">
          {g.principles.map(({ title, body }) => (
            <li key={title}>
              <p className="text-ui font-medium">{title}</p>
              <p className="mt-0.5 text-small text-pretty text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}
