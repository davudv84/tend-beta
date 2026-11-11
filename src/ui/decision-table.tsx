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
  const rows: DecisionRow[] = events.map((e) => {
    const trail = "steps" in e ? trailOf(e) : [];
    return {
    key: e.id,
    time: clock(e.at),
    dateTime: new Date(e.at).toISOString(),
    title: new Date(e.at).toLocaleString(t.intl.date),
    agent: nameOf?.(e.agentId),
    detail: e.detail,
    action: actionOf(e),
    outcome: trail.at(-1) ?? outcomeOf(e),
    reason: reasonOf(t, "steps" in e ? decidingStep(e) : e),
    ...(trail.length > 1 && { path: trail }),
  };
  });
  return <DecisionRows rows={rows} agents={!!nameOf} compact={compact} />;
}

/** One line of the table, already in words. */
export interface DecisionRow {
  key: string;
  time: string;
  dateTime?: string;
  title?: string;
  agent?: string;
  /** The exact request as the agent sent it. */
  detail?: string;
  /** The recorded tool and action. */
  action: string;
  outcome?: Outcome | null;
  /** The steps the action went through when there were several ("Needs approval → Approved → Ran"). */
  path?: Outcome[];
  reason: string;
}

/**
 * The table itself, with nothing behind it: DecisionTable gives it recorded events, the homepage's demo invented ones. One markup for both.
 */
/**
 * `phone` keeps the phone arrangement at any width and sets the small words at 14px, for a phone-sized frame on a wider screen (the
 * homepage's demo on a tablet).
 */
export function DecisionRows({ rows, agents, compact, phone }: { rows: DecisionRow[]; agents: boolean; compact?: boolean; phone?: boolean }) {
  const t = useT();
  const pad = phone ? "px-4 py-3.5" : compact ? "px-3 py-3 sm:px-6" : "px-3 py-3.5 sm:px-6";
  // On a phone the time, agent and reason columns give way so the request and outcome stay readable; the agent moves under the
  // request and the reason under the outcome.
  const optional = phone ? "hidden" : "hidden sm:table-cell";
  const onlyPhone = phone ? "" : "sm:hidden";
  const small = phone ? "text-[14px]" : "text-[13px]";
  const smaller = phone ? "text-[14px]" : "text-[12px]";
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-left text-[14px] ${phone ? "" : "sm:min-w-[680px]"}`}>
        <thead className={`bg-[#fafafa] ${small} text-muted-foreground dark:bg-sunken`}><tr>{t.home.overview.columns.map((c, i) => (i === 1 && !agents ? null : <th key={c} scope="col" className={`${phone ? "px-4" : "px-3 sm:px-6"} py-3 font-normal ${i === 0 || i === 1 || i === 4 ? optional : ""}`}>{c}</th>))}</tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className={`${pad} ${optional} whitespace-nowrap text-muted-foreground tabular-nums`}><time dateTime={r.dateTime} title={r.title}>{r.time}</time></td>
              {agents && <td className={`${pad} ${optional} font-medium`}>{r.agent}</td>}
              {/* The exact request as the agent sent it, with the recorded tool and action under it. */}
              <td className={`${pad} font-mono ${small} [overflow-wrap:anywhere]`}>{r.detail ?? r.action}<span className={`mt-0.5 block ${smaller} text-faint`}>{agents && <span className={`font-sans ${onlyPhone}`}>{phone && `${r.time} · `}{r.agent}{r.detail && " · "}</span>}{r.detail && r.action}</span></td>
              <td className={pad}>{r.outcome && <Badge tone={TONE[r.outcome] ?? "neutral"}>{t.timelinePage.outcome[r.outcome]}</Badge>}{r.path && <span className={`mt-1 block ${smaller} text-faint`}>{r.path.map((x) => t.timelinePage.outcome[x]).join(" → ")}</span>}<span className={`mt-1.5 block ${small} text-muted-foreground ${onlyPhone}`}>{r.reason}</span></td>
              <td className={`${pad} ${optional} text-muted-foreground`}>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
