"use client";

import Link from "next/link";
import { useCallback } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import type { DecisionRow } from "@/ui/decision-table";
import { RequestCardView } from "@/ui/request-card-view";
import type { Stat } from "@/ui/stats-grid";
import { cn } from "@/lib/utils";
import { mmss, type ActivityLine, type Demo, type DemoId, type Waiting } from "./use-demo";

/** The exact request of each demo request, in the reader's language: what is decided, and what Activity records. */
export function useExactOf() {
  const t = useT();
  const r = t.front.demo.requests;
  return useCallback((id: DemoId) => r[id].exact, [r]);
}

/**
 * One waiting request, drawn by the app's own card (ui/request-card-view.tsx) with the demo's invented data. Allowing and not allowing
 * act at once; the countdown is live.
 */
export function DemoCard({ waiting, onDecide, className }: { waiting: Waiting; onDecide: (decision: "allowed" | "denied") => void; className?: string }) {
  const t = useT();
  const h = t.home.request;
  const d = t.front.demo;
  const { request: q, left } = waiting;
  const words = d.requests[q.id];
  const kind = q.kind === "spend" || q.kind === "run" ? h.kind[q.kind] : d.kinds[q.kind];
  const asked = q.askedMinutesAgo ? t.time.ago(q.askedMinutesAgo, "m") : d.justNow;
  return (
    <RequestCardView
      className={className}
      kind={kind}
      loud={q.kind === "spend" || q.kind === "run" || q.kind === "data"}
      sentence={words.sentence}
      meta={<>{h.asked(asked)} · <span className="tabular-nums">{d.lapses(mmss(left))}</span></>}
      exact={{ label: h.exact, text: words.exact, mono: q.mono }}
      item={q.item ? { label: h.rows.item, value: q.item } : undefined}
      why={{ label: h.why, value: words.why }}
      labels={{ allow: h.allow, deny: h.deny, details: h.details, saving: h.saving, promise: h.promise }}
      onAllow={() => onDecide("allowed")}
      onDeny={() => onDecide("denied")}
      change={<Link href="/how-it-works#steps" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">{h.change}</Link>}
      details={[
        { label: d.rows.agent, value: q.agent },
        { label: d.rows.tool, value: `${q.tool} · ${q.action}`, mono: true },
        { label: d.rows.asked, value: asked },
        { label: d.rows.rule, value: words.rule },
      ]}
    />
  );
}

/** The four numbers, from the demo's state. */
export function useStats(demo: Demo): Stat[] {
  const s = useT().home.dash.stats;
  return [
    { label: s.running, value: 2, note: s.of(3) },
    { label: s.waiting, value: demo.waiting.length, note: s.now },
    { label: s.auto, value: demo.auto, note: s.day },
    { label: s.blocked, value: demo.blocked, note: s.day },
  ];
}

/** Activity lines in words, for the app's own table (ui/decision-table.tsx). */
export function useActivityRows(lines: ActivityLine[]): DecisionRow[] {
  const t = useT();
  const g = t.timelinePage;
  const reasons = t.front.demo.reasons;
  return lines.map((l) => ({
    key: l.key,
    time: l.time,
    agent: l.agent,
    detail: l.detail,
    action: l.action,
    outcome: l.outcome,
    reason:
      l.reason.kind === "history"
        ? (() => {
            const w = l.reason.decision.why;
            return w.kind === "rule" ? g.rule(w.rule) : w.kind === "person" ? g.by.person : (g.reasons[w.reason] ?? w.reason);
          })()
        : reasons[l.reason.kind],
  }));
}

/** The short note after a decision, like the app's own toast. */
export function DemoToast({ demo, className }: { demo: Demo; className?: string }) {
  const d = useT().front.demo;
  const toast = demo.toast;
  return (
    <div aria-hidden className={cn("pointer-events-none transition-all duration-300 motion-reduce:transition-none", toast ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0", className)}>
      {toast && (
        <p className="flex items-center gap-2.5 rounded-xl border border-border bg-elevated px-4 py-3 text-[14px] text-foreground shadow-[0_12px_32px_-12px_rgb(0_0_0/0.7)]">
          {toast.decision === "allowed" ? <CheckIcon className="size-4 shrink-0 text-primary" strokeWidth={2} /> : <XIcon className="size-4 shrink-0 text-clay" strokeWidth={2} />}
          {d.toast[toast.decision === "allowed" ? "allowed" : "denied"]}
        </p>
      )}
    </div>
  );
}

/** What changed, said to a screen reader: allowed, not allowed or expired. */
export function Announcer({ demo }: { demo: Demo }) {
  const d = useT().front.demo;
  const a = demo.announce;
  const text = a ? d.announce[a] : "";
  return <p aria-live="polite" className="sr-only">{text}</p>;
}

/** Answered: nothing waits any more. */
export function AllClear({ className }: { className?: string }) {
  const d = useT().front.demo;
  return (
    <div className={cn("flex flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-border px-6 py-12 text-center", className)}>
      <span className="grid size-10 place-items-center rounded-full bg-primary/15 text-primary"><CheckIcon className="size-5" strokeWidth={2} aria-hidden /></span>
      <p className="max-w-[30ch] text-[15px] text-foreground">{d.empty}</p>
    </div>
  );
}
