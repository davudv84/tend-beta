"use client";

import Link from "next/link";
import { sentence } from "@/components/feed";
import { useT } from "@/i18n/client";
import { outcomeOf, type Outcome } from "@/lib/activity";
import type { TimelineEvent } from "@/lib/derive";
import { clock, eventHref } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The outcome is a word, never only a colour. Only warnings are coloured. */
const WARN: Outcome[] = ["alert", "failed"];

/** One thing that happened: when, which assistant, what it did, and how it ended. The same row on Home and on Activity. */
export function ActivityRow({ event, name }: { event: TimelineEvent; name: (id: string) => string }) {
  const t = useT();
  const { subject, predicate } = sentence(t, event, name);
  const outcome = outcomeOf(event);
  const body = (
    <>
      <time className="w-12 shrink-0 pt-px text-small text-muted-foreground tabular-nums" dateTime={new Date(event.at).toISOString()} title={new Date(event.at).toLocaleString(t.intl.date)}>
        {clock(event.at)}
      </time>
      <span className="min-w-0 flex-1">
        <span className="block text-body text-pretty text-muted-foreground">
          <span className="font-medium text-foreground">{subject}</span> {predicate}
        </span>
        {event.note && <span className="mt-0.5 block text-small text-pretty text-faint">{t.quote(event.note)}</span>}
      </span>
      {outcome && (
        <span className={cn("shrink-0 pt-px text-small", WARN.includes(outcome) ? "font-medium text-clay" : outcome === "needs_approval" ? "font-medium text-foreground" : "text-muted-foreground")}>
          {t.timelinePage.outcome[outcome]}
        </span>
      )}
    </>
  );
  const row = "-mx-3 flex items-start gap-4 rounded-xl px-3 py-2.5";
  const href = event.checkInId ? `/check-ins/${event.checkInId}` : event.eventId ? eventHref(event.eventId) : null;
  return <li>{href ? <Link href={href} className={cn(row, "transition-colors duration-200 hover:bg-sunken")}>{body}</Link> : <div className={row}>{body}</div>}</li>;
}
