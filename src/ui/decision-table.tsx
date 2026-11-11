"use client";

import { useT } from "@/i18n/client";
import { decidingStep, outcomeOf, trailOf, type ActionRow, type Outcome } from "@/lib/activity";
import type { TimelineEvent } from "@/lib/derive";
import { clock } from "@/lib/format";
import { Badge, type Tone } from "@/ui/primitives";

const TONE: Partial<Record<Outcome, Tone>> = { needs_approval: "attention", blocked: "danger", rejected: "danger", alert: "danger", failed: "danger" };

/** What was attempted: the tool and action as recorded, never a reconstruction. */
export function actionOf(e: TimelineEvent) {
  const a = e.say.k === "log" ? e.say.args : undefined;
  return a?.tool ? `${a.tool}.${a.action ?? ""}` : e.say.k === "task" ? e.say.title ?? "" : "";
}

/**
 * Why it ended this way, in words, from what was recorded: the policy rule that decided it, a person's decision, or the agent's own report
 * after the fact (which TEND did not check before it ran). The recorded code itself when there is no wording for it.
 */
export function reasonOf(t: ReturnType<typeof useT>, e: TimelineEvent) {
  const g = t.timelinePage;
  if (e.say.k === "task") return e.say.type === "tool.called" && (e.outcome === "success" || e.outcome === "failure") ? g.by.agent : e.note ?? "";
  const args = e.say.k === "log" ? e.say.args : undefined;
  if (e.say.k === "log" && args?.rule && (e.say.type === "authorization_requested" || e.say.type === "authorization_denied")) return g.rule(args.rule);
  if (e.kind === "decision" && e.actor === "human") return [g.by.person, e.note].filter(Boolean).join(" · ");
  // A note that only repeats the request (shown in the action column already) says nothing more.
  return args?.reason ? g.reasons[args.reason] ?? args.reason : e.note && e.note !== e.detail ? e.note : "";
}

/** Events as a table: when, which agent, what was attempted, how it ended, and why. The same on Overview and Activity. */
/** `nameOf` is left out on a single agent's own page, where an agent column would only repeat its name. */
/** Rows from byAction() show how the action ended, the path it took to get there, and the reason of the step that decided it. */
export function DecisionTable({ events, nameOf, compact }: { events: (TimelineEvent | ActionRow)[]; nameOf?: (id: string) => string; compact?: boolean }) {
  const t = useT();
  const pad = compact ? "px-3 py-3 sm:px-6" : "px-3 py-3.5 sm:px-6";
  // On a phone the time, agent and reason columns give way so the request and outcome stay readable; the agent moves under the
  // request and the reason under the outcome.
  const optional = "hidden sm:table-cell";
  return (
    <div className="overflow-x-auto">
      <table className="w-full sm:min-w-[680px] text-left text-[14px]">
        <thead className="bg-[#fafafa] text-[13px] text-muted-foreground dark:bg-sunken"><tr>{t.home.overview.columns.map((c, i) => (i === 1 && !nameOf ? null : <th key={c} scope="col" className={`px-3 py-3 font-normal sm:px-6 ${i === 0 || i === 1 || i === 4 ? optional : ""}`}>{c}</th>))}</tr></thead>
        <tbody className="divide-y divide-border">
          {events.map((e) => {
            const trail = "steps" in e ? trailOf(e) : [];
            const o = trail.at(-1) ?? outcomeOf(e);
            const why = reasonOf(t, "steps" in e ? decidingStep(e) : e);
            const path = trail.length > 1 && <span className="mt-1 block text-[12px] text-faint">{trail.map((x) => t.timelinePage.outcome[x]).join(" → ")}</span>;
            return (
              <tr key={e.id}>
                <td className={`${pad} ${optional} whitespace-nowrap text-muted-foreground tabular-nums`}><time dateTime={new Date(e.at).toISOString()} title={new Date(e.at).toLocaleString(t.intl.date)}>{clock(e.at)}</time></td>
                {nameOf && <td className={`${pad} ${optional} font-medium`}>{nameOf(e.agentId)}</td>}
                {/* The exact request as the agent sent it, with the recorded tool and action under it. */}
                <td className={`${pad} font-mono text-[13px] [overflow-wrap:anywhere]`}>{e.detail ?? actionOf(e)}<span className="mt-0.5 block text-[12px] text-faint">{nameOf && <span className="font-sans sm:hidden">{nameOf(e.agentId)}{e.detail && " · "}</span>}{e.detail && actionOf(e)}</span></td>
                <td className={pad}>{o && <Badge tone={TONE[o] ?? "neutral"}>{t.timelinePage.outcome[o]}</Badge>}{path}<span className="mt-1.5 block text-[13px] text-muted-foreground sm:hidden">{why}</span></td>
                <td className={`${pad} ${optional} text-muted-foreground`}>{why}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
