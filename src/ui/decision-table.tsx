"use client";

import { useT } from "@/i18n/client";
import { outcomeOf, type Outcome } from "@/lib/activity";
import type { TimelineEvent } from "@/lib/derive";
import { clock } from "@/lib/format";
import { Badge, type Tone } from "@/ui/primitives";

const TONE: Partial<Record<Outcome, Tone>> = { needs_approval: "attention", blocked: "danger", rejected: "danger", alert: "danger", failed: "danger" };

/** What was attempted: the tool and action as recorded, never a reconstruction. */
export function actionOf(e: TimelineEvent) {
  const a = e.say.k === "log" ? e.say.args : undefined;
  return a?.tool ? `${a.tool}.${a.action ?? ""}` : e.say.k === "task" ? e.say.title ?? "" : "";
}

/** The recorded reason for a decision, in words; the recorded code itself when there is no wording for it. */
export function reasonOf(t: ReturnType<typeof useT>, e: TimelineEvent) {
  const code = e.say.k === "log" ? e.say.args?.reason : undefined;
  return code ? t.timelinePage.reasons[code] ?? code : e.note ?? "";
}

/** Events as a table: when, which agent, what was attempted, how it ended, and why. The same on Overview and Activity. */
export function DecisionTable({ events, nameOf, compact }: { events: TimelineEvent[]; nameOf: (id: string) => string; compact?: boolean }) {
  const t = useT();
  const pad = compact ? "px-3 py-3 sm:px-6" : "px-3 py-3.5 sm:px-6";
  // On a phone the time and reason columns give way so the outcome stays on screen; the reason moves under the outcome.
  const optional = "hidden sm:table-cell";
  return (
    <div className="overflow-x-auto">
      <table className="w-full sm:min-w-[680px] text-left text-[14px]">
        <thead className="bg-[#fafafa] text-[13px] text-muted-foreground dark:bg-sunken"><tr>{t.home.overview.columns.map((c, i) => <th key={c} scope="col" className={`px-3 py-3 font-normal sm:px-6 ${i === 0 || i === 4 ? optional : ""}`}>{c}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">
          {events.map((e) => {
            const o = outcomeOf(e);
            return (
              <tr key={e.id}>
                <td className={`${pad} ${optional} whitespace-nowrap text-muted-foreground tabular-nums`}><time dateTime={new Date(e.at).toISOString()} title={new Date(e.at).toLocaleString(t.intl.date)}>{clock(e.at)}</time></td>
                <td className={`${pad} font-medium`}>{nameOf(e.agentId)}</td>
                <td className={`${pad} font-mono text-[13px] break-all sm:break-normal`}>{actionOf(e)}</td>
                <td className={pad}>{o && <Badge tone={TONE[o] ?? "neutral"}>{t.timelinePage.outcome[o]}</Badge>}<span className="mt-1.5 block text-[13px] text-muted-foreground sm:hidden">{reasonOf(t, e)}</span></td>
                <td className={`${pad} ${optional} text-muted-foreground`}>{reasonOf(t, e)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
