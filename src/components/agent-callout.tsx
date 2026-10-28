"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowUpRightIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { agentState, Dot, OriginTag } from "@/components/kit";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n/client";
import { errorText, type Dict } from "@/i18n";
import { QUESTIONS } from "@/lib/contract";
import { clock, timeAgo, useNow } from "@/lib/format";
import { isOnline } from "@/lib/projection";
import { reflectionNumber } from "@/lib/reflections";
import { useStore } from "@/lib/store";
import type { Agent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AgentFigure } from "@/sanctuary/figure";

export type StateCode = keyof Dict["state"]["describe"];

/** Plain-language state for an agent, from data plus where its figure is (a garden spot id, e.g. "pond"). */
export function describe(t: Dict, a: Agent, opts: { working: boolean; place?: string; walking?: boolean; now?: number }): { code: StateCode; state: string; where: string } {
  const is = (code: StateCode, where: string) => ({ code, state: t.state.describe[code], where });
  if (!a.integrationEnabled) return is("disabled", t.state.away);
  if (a.status === "paused") return is("paused", t.state.inRoom);
  if (!isOnline(a, opts.now ?? Date.now())) return is("offline", t.state.inRoom);
  const spot = opts.place ? t.spots[opts.place as keyof Dict["spots"]] : undefined;
  const where = spot ? spot[opts.walking ? 1 : 0] : t.state.inWorld;
  if (opts.place === "lounge") return is("reporting", where);
  return is(opts.working ? "working" : "idle", where);
}

/** A control that may be unavailable; when it is, it says why instead of pretending. */
export function Gated({ allowed, reason, children }: { allowed: boolean; reason: string; children: React.ReactElement }) {
  if (allowed) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="block w-full">{children}</span></TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export function useReadOnlyReason() {
  const t = useT();
  const viewer = useStore((s) => s.viewer);
  return viewer?.public ? t.common.readOnlyPublic : t.common.readOnlySignIn;
}

/** The floating panel for one agent, drawn beside its figure. Not a modal: the scene stays live. */
export function AgentCallout({ agent, where, state, onClose, className, style, inline }: {
  agent: Agent; where: string; state: string; onClose: () => void; className?: string; style?: React.CSSProperties;
  /** Rendered inside a panel or sheet rather than floating over the scene. */
  inline?: boolean;
}) {
  const t = useT();
  const c = t.callout;
  const checkIns = useStore((s) => s.checkIns);
  const requests = useStore((s) => s.requests);
  const taskEvents = useStore((s) => s.taskEvents);
  const ask = useStore((s) => s.asks[agent.id]);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const skew = useStore((s) => s.skew);
  const requestCheckIn = useStore((s) => s.requestCheckIn);
  const setPaused = useStore((s) => s.setPaused);
  const readOnly = useReadOnlyReason();
  const now = useNow() + skew;
  const heading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState<"ask" | "pause" | null>(null);

  const { latest, reflection, pending, recent } = useMemo(() => {
    const mine = checkIns.filter((c) => c.agentId === agent.id);
    return {
      latest: mine[0],
      reflection: mine.find((c) => c.reflection),
      pending: [...mine.filter((c) => c.review?.status === "pending"), ...requests.filter((r) => r.agentId === agent.id && r.review.status === "pending")],
      recent: taskEvents.filter((t) => t.agentId === agent.id).slice(0, 3),
    };
  }, [checkIns, requests, taskEvents, agent.id]);

  const concerns = latest ? QUESTIONS.filter((q) => q.concern.includes(latest.responses[q.id].answer)) : [];
  const status = agentState(agent, now);
  const unavailable = status.tone === "off";

  useEffect(() => {
    if (!inline) heading.current?.focus();
  }, [agent.id, inline]);

  // Announce the answer to a request when it actually arrives.
  const waiting = useRef(false);
  const seen = useRef(latest?.id);
  useEffect(() => {
    if (latest && latest.id !== seen.current && waiting.current) {
      toast.success(c.toast.reported(agent.name), { description: latest.source === "simulated" ? c.toast.simulated : c.toast.connected });
      waiting.current = false;
    }
    seen.current = latest?.id;
  }, [latest, agent.name, c]);

  const askForCheckIn = async () => {
    setBusy("ask");
    const r = await requestCheckIn(agent.id);
    setBusy(null);
    if (!r.ok) return toast.error(c.toast.askFailed, { description: errorText(t, r) });
    waiting.current = true;
    toast(c.toast.asked(agent.name), { description: agent.origin === "connected" ? c.toast.queued : c.toast.logged });
  };

  const togglePause = async () => {
    setBusy("pause");
    const paused = agent.status === "paused";
    const r = await setPaused(agent.id, !paused);
    setBusy(null);
    if (!r.ok) return toast.error(paused ? c.toast.notResumed : c.toast.notPaused, { description: errorText(t, r) });
    toast.success(paused ? c.toast.resumed(agent.name) : c.toast.paused(agent.name), {
      description: agent.origin === "connected" ? c.toast.pausedConnected : c.toast.recorded,
    });
  };

  const syncing = agent.origin === "connected" && agent.ackedVersion < agent.configVersion;

  return (
    <div role={inline ? "region" : "dialog"} aria-label={c.details(agent.name)} onKeyDown={(e) => e.key === "Escape" && onClose()}
      className={cn(inline ? "w-full" : "w-[330px] border border-[#3a362f] bg-[#13120f] shadow-[0_24px_60px_-20px_rgb(0_0_0/0.8)]", className)} style={style}>
      <div className="flex items-start gap-4 border-b border-border px-5 pt-4 pb-3.5">
        <AgentFigure id={agent.id} scale={3} className="-mt-1 -mb-2" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h2 ref={heading} tabIndex={-1} className="text-h2 outline-none">{agent.name}</h2>
            <button onClick={onClose} aria-label={t.common.close} className="-mt-1 -mr-2 p-1 text-faint transition-colors hover:text-foreground"><XIcon className="size-4" /></button>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-meta text-faint">{agent.model} · {agent.provider} <OriginTag agent={agent} /></p>
          <p className="mt-2.5 flex items-center gap-2 text-small"><Dot tone={status.tone} />{state}</p>
          <p className="text-small text-muted-foreground">{where}</p>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 px-5 py-3.5 text-small">
        <dt className="text-faint">{c.lastReport}</dt>
        <dd className="text-right text-muted-foreground">{latest ? timeAgo(latest.createdAt, now) : "—"}</dd>
        <dt className="text-faint">{c.concerns}</dt>
        <dd className="truncate text-right text-muted-foreground" title={concerns.map((q) => t.questions[q.id].short).join(", ") || undefined}>{concerns.length ? concerns.map((q) => t.questions[q.id].short).join(", ") : t.common.none}</dd>
        <dt className="text-faint">{c.pending}</dt>
        <dd className={cn("text-right", pending.length ? "text-amber" : "text-muted-foreground")}>{pending.length || t.common.none}</dd>
        {agent.origin === "connected" && (
          <>
            <dt className="text-faint">{c.lastHeard}</dt>
            <dd className="text-right text-muted-foreground">{agent.lastSeenAt ? timeAgo(agent.lastSeenAt, now) : t.common.never}</dd>
            <dt className="text-faint">{c.config}</dt>
            <dd className={cn("text-right", syncing ? "text-amber" : "text-muted-foreground")}>{syncing ? c.configPending(agent.configVersion) : c.configApplied(agent.configVersion)}</dd>
          </>
        )}
      </dl>

      {recent.length > 0 && (
        <ol className="border-t border-border px-5 py-3" aria-label={c.recentTasks}>
          {recent.map((e) => (
            <li key={e.id} className="flex gap-3 py-0.5 text-caption">
              <span className="font-mono text-meta text-faint tabular-nums">{clock(e.at)}</span>
              <span className="min-w-0 truncate text-muted-foreground">{t.task.line[e.type](e.title)}</span>
            </li>
          ))}
        </ol>
      )}

      {(reflection || latest?.feedback) && (
        <figure className="border-t border-border px-5 py-3.5">
          <blockquote className="quote line-clamp-3 text-body text-foreground/90">{t.quote(reflection?.reflection ?? latest?.feedback ?? "")}</blockquote>
          <figcaption className="mt-2 font-mono text-meta text-faint">
            {reflection ? c.noteCaption(reflectionNumber(checkIns, reflection)) : c.feedbackCaption}
          </figcaption>
        </figure>
      )}

      <div className="grid gap-2 border-t border-border p-3">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Gated allowed={canAct && !unavailable} reason={!canAct ? readOnly : c.cantAsk(t.state.label[status.key])}>
            <button onClick={askForCheckIn} disabled={!canAct || unavailable || !!ask || busy !== null}
              className="flex h-9 w-full items-center justify-center gap-2 bg-primary px-2 text-small font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
              {busy === "ask" && <LoaderCircleIcon className="size-3.5 animate-spin" />}
              <span className="truncate">{ask ? (ask.delivered ? c.delivered(agent.name) : agent.origin === "connected" ? c.requested : c.waiting(agent.name)) : c.ask}</span>
            </button>
          </Gated>
          <Gated allowed={canAct && agent.integrationEnabled} reason={!canAct ? readOnly : c.enableFirst}>
            <button onClick={togglePause} disabled={!canAct || !agent.integrationEnabled || busy !== null}
              className="h-9 border border-border px-3 text-small text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
              {agent.status === "paused" ? c.resume : c.pause}
            </button>
          </Gated>
        </div>
        <nav className="grid text-small text-muted-foreground">
          <CalloutLink href={`/reflections?agent=${agent.id}`}>{c.viewNotes}</CalloutLink>
          <CalloutLink href={pending[0] && "responses" in pending[0] ? `/check-ins/${pending[0].id}` : "/oversight"} disabled={!pending.length}>
            {pending.length ? c.reviewConcerns : c.noConcerns}
          </CalloutLink>
          <CalloutLink href={`/agents/${agent.id}`}>{c.viewHistory}</CalloutLink>
        </nav>
      </div>
    </div>
  );
}

function CalloutLink({ href, children, disabled }: { href: string; children: React.ReactNode; disabled?: boolean }) {
  if (disabled) return <span className="flex h-9 items-center px-2 text-faint">{children}</span>;
  return (
    <Link href={href} className="group flex h-9 items-center justify-between px-2 transition-colors hover:bg-elevated/70 hover:text-foreground">
      {children} <ArrowUpRightIcon className="size-3.5 opacity-40 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
