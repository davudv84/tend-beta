"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronRightIcon } from "lucide-react";
import { AgentAvatar, AnswerGlyphs, Dot, type Tone } from "@/components/kit";
import { useT } from "@/i18n/client";
import type { Dict } from "@/i18n";
import { checkInEvent, type EventKind, type TimelineEvent } from "@/lib/derive";
import { clock, dayLabel, eventHref, timeAgo } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Agent, CheckIn, ReviewStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const KIND_TONE: Record<EventKind, Tone> = {
  check_in: "sage", task: "muted", conflict: "amber", context: "amber", review: "amber", decision: "white", authorization: "sage", control: "muted", alert: "amber",
};

export const KINDS = Object.keys(KIND_TONE) as EventKind[];

/** An event as "subject predicate": the subject (an agent, a reviewer or the system) is shown in bold. */
export function sentence(t: Dict, e: TimelineEvent, name: (id: string) => string) {
  const s = e.say;
  const predicate = s.k === "task" ? t.say.task[s.type](s.title) : s.k === "log" ? t.say.log[s.type]({ name: name(e.agentId), ...s.args }) : t.say[s.k];
  const subject = e.actor === "agent" ? name(e.agentId) : e.actor === "human" ? t.common.reviewer : t.common.system;
  return { subject, predicate };
}

function useAgentMap() {
  const agents = useStore((s) => s.agents);
  return new Map<string, Agent>(agents.map((a) => [a.id, a]));
}

/** Chronological feed. Items that arrive after mount fade in; nothing else moves. */
export function Feed({ events, now, grouped, className }: { events: TimelineEvent[]; now: number; grouped?: boolean; className?: string }) {
  const t = useT();
  const agents = useAgentMap();
  const name = (id: string) => agents.get(id)?.name ?? id;
  const [mountedAt] = useState(() => Date.now());
  const days = events.map((e) => dayLabel(e.at, now));
  return (
    <ol className={cn("relative", className)}>
      {events.map((e, i) => {
        const day = days[i];
        const header = grouped && day !== days[i - 1];
        const { subject, predicate } = sentence(t, e, name);
        const body = (
          <>
            <time className="w-11 shrink-0 pt-px font-mono text-xs text-faint tabular-nums" dateTime={new Date(e.at).toISOString()} title={new Date(e.at).toLocaleString(t.intl.date)}>
              {clock(e.at)}
            </time>
            <span className="relative flex w-3 shrink-0 justify-center pt-[7px]"><Dot tone={KIND_TONE[e.kind]} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">{subject}</span> {predicate}
              </span>
              {e.note && <span className="mt-0.5 block text-small leading-relaxed text-faint">{t.quote(e.note)}</span>}
            </span>
            {(e.checkInId || e.eventId) && <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />}
          </>
        );
        const row = "group flex gap-3 rounded-md px-2 py-2 -mx-2";
        return (
          <motion.li key={e.id} initial={e.at > mountedAt ? { opacity: 0, y: -4 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: "easeOut" }}>
            {header && <p className="eyebrow mt-6 mb-2 first:mt-0">{day}</p>}
            {e.checkInId || e.eventId ? (
              <Link href={e.checkInId ? `/check-ins/${e.checkInId}` : eventHref(e.eventId!)} className={cn(row, "transition-colors hover:bg-elevated/60")}>{body}</Link>
            ) : (
              <div className={row}>{body}</div>
            )}
          </motion.li>
        );
      })}
    </ol>
  );
}

const BADGE: Record<ReviewStatus, string> = {
  pending: "bg-amber/10 text-amber",
  approved: "bg-sage/10 text-sage",
  rejected: "bg-elevated text-muted-foreground",
  acknowledged: "bg-elevated text-muted-foreground",
  withdrawn: "bg-elevated text-muted-foreground",
};

export function ReviewBadge({ status }: { status?: ReviewStatus }) {
  const t = useT();
  if (!status) return null;
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-meta font-medium whitespace-nowrap", BADGE[status])}>{t.review.badge[status]}</span>;
}

export function CheckInRow({ checkIn, agent, now, showAgent = true }: { checkIn: CheckIn; agent?: Agent; now: number; showAgent?: boolean }) {
  const t = useT();
  const ev = checkInEvent(checkIn);
  return (
    <Link href={`/check-ins/${checkIn.id}`} className="group flex items-center gap-4 px-2 py-3.5 transition-colors hover:bg-elevated/50 md:px-3">
      {showAgent && agent && <AgentAvatar agent={agent} size="sm" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {showAgent && <span className="font-medium">{agent?.name} </span>}
          <span className="text-muted-foreground">{t.say[ev.say.k]}</span>
        </p>
        <p className="mt-0.5 truncate text-small text-faint">{checkIn.feedback || t.feed.noFeedback}</p>
      </div>
      <AnswerGlyphs checkIn={checkIn} className="hidden sm:inline-flex" />
      <ReviewBadge status={checkIn.review?.status} />
      <span className="min-w-16 shrink-0 text-right font-mono text-xs whitespace-nowrap text-faint tabular-nums">{timeAgo(checkIn.createdAt, now)}</span>
    </Link>
  );
}
