"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import type { DecisionRow } from "@/ui/decision-table";
import type { Stat } from "@/ui/stats-grid";
import { cn } from "@/lib/utils";
import { SampleCard } from "./sample-card";
import { minutesLeft, type ActivityLine, type Demo, type Waiting } from "./use-demo";

/**
 * The waiting request, drawn exactly as the app's card (sample-card.tsx), counting down in whole minutes like the app. Payments ask
 * "Allow this exact request once?" before they are allowed, as in the app.
 */
export function DemoCard({ waiting, onDecide, className }: { waiting: Waiting; onDecide: (decision: "allowed" | "denied") => void; className?: string }) {
  return <SampleCard request={waiting.request} agentName="ops-agent" askedAt="14:02" lapsesAt="14:10" minutesLeft={minutesLeft(waiting.left)} onAnswered={onDecide} className={className} />;
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
  return lines.map((l) => ({
    key: l.key,
    time: l.time,
    agent: l.agent,
    detail: l.detail,
    action: l.action,
    outcome: l.outcome,
    ...(l.path && { path: l.path }),
    reason:
      l.reason.kind === "history"
        ? (() => {
            const w = l.reason.decision.why;
            return w.kind === "rule" ? g.rule(w.rule) : w.kind === "person" ? g.by.person : (g.reasons[w.reason] ?? w.reason);
          })()
        : l.reason.kind === "expired" ? g.reasons.expired ?? g.outcome.expired : g.by.person,
  }));
}

/** The short note after a decision, like the app's own toast. */
export function DemoToast({ demo, className }: { demo: Demo; className?: string }) {
  const h = useT().home.request;
  const toast = demo.toast;
  return (
    <div aria-hidden className={cn("pointer-events-none transition-all duration-300 motion-reduce:transition-none", toast ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0", className)}>
      {toast && (
        <p className="flex items-center gap-2.5 rounded-xl border border-border bg-elevated px-4 py-3 text-[14px] text-foreground shadow-[0_12px_32px_-12px_rgb(0_0_0/0.7)]">
          {toast.decision === "allowed" ? <CheckIcon className="size-4 shrink-0 text-primary" strokeWidth={2} /> : <XIcon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />}
          {toast.decision === "allowed" ? h.allowed : h.denied}
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

