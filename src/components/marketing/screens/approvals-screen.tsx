"use client";

import { ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { fromHook, requestKind, showsContent } from "@/lib/home";
import { cn } from "@/lib/utils";
import { Badge, Card } from "@/ui/primitives";
import { HISTORY, INVOICE_REQUEST, OPS_AGENT, PUSH_REQUEST, REPO_HELPER, type DemoDecision } from "../demo-data";
import { AppShell } from "./app-shell";

const TABS = ["authorizations", "queue", "log", "controls", "connected"] as const;

/** The Approvals screen as the app shows it (app/(next)/oversight/view.tsx), with two requests waiting and three decisions made. */
export function ApprovalsScreen() {
  const t = useT();
  const g = t.oversightPage;
  return (
    <AppShell active="approvals" waiting={2}>
      <div className="mx-auto w-full max-w-[1180px] px-12 pt-14 pb-24">
        <header className="mb-10">
          <h1 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em] text-balance">{g.title}</h1>
          <p className="mt-2 max-w-[60ch] text-[15px] text-pretty text-muted-foreground">{g.description}</p>
        </header>
        <div className="mb-8 flex w-full gap-6 border-b border-border pb-[3px] text-ui">
          {TABS.map((tab) => (
            <span key={tab} className={cn("relative inline-flex items-center gap-1.5 py-0.5 text-sm font-medium", tab === "authorizations" ? "text-foreground after:absolute after:inset-x-0 after:bottom-[-5px] after:h-0.5 after:bg-foreground" : "text-foreground/60")}>
              {g.tabs[tab]} {tab === "authorizations" && <span className="text-caption text-muted-foreground tabular-nums">2</span>}
            </span>
          ))}
        </div>
        <section>
          <h2 className="text-[17px] font-semibold">{g.waitingTitle}</h2>
          <p className="mt-1 text-[14px] text-muted-foreground">{g.waitingSub}</p>
          <ul className="mt-4 grid gap-4">
            <li><DemoRequestCard request={INVOICE_REQUEST} agentName={OPS_AGENT.name} /></li>
            <li><DemoRequestCard request={PUSH_REQUEST} agentName={REPO_HELPER.name} /></li>
          </ul>
        </section>
        <section className="mt-8">
          <h2 className="text-[17px] font-semibold">{g.historyTitle}</h2>
          <Card className="mt-4"><DecisionRows rows={HISTORY} /></Card>
        </section>
      </div>
    </AppShell>
  );
}

/** One waiting request, as ui/request-card.tsx lays it out, with the demo's own times (minutes, not clock readings). */
export function DemoRequestCard({ request, agentName }: { request: typeof INVOICE_REQUEST; agentName: string }) {
  const t = useT();
  const h = t.home.request;
  const kind = requestKind(request.tool);
  const hook = fromHook(request.tool);
  const sentence = h.sentence(request.tool, agentName, request.resource ?? "", request.action);
  const why = request.rule ? (request.rule.effect === "approve" ? t.timelinePage.rule(request.rule) : h.whyAlways) : (t.timelinePage.reasons[request.reason ?? ""] ?? request.reason);
  const loud = kind === "spend" || kind === "unknown" || kind === "run";
  const button = "h-11 rounded-full px-6 text-ui";
  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgb(0_0_0/0.03)] md:p-6">
      <p className={loud ? "text-small font-medium text-foreground" : "text-small text-muted-foreground"}>{h.kind[kind]}</p>
      <h3 className="mt-2 text-heading text-balance">{sentence}</h3>
      <p className="mt-2 text-small text-muted-foreground">{h.asked(t.time.ago(request.askedMinutesAgo, "m"))} · {h.lapsesIn(request.lapsesInMinutes)}</p>
      {(showsContent(kind) || hook) && request.detail && (
        <>
          <p className="mt-6 text-caption text-faint">{h.exact}</p>
          <blockquote className={cn("mt-2 rounded-2xl bg-sunken px-5 py-4 break-words whitespace-pre-wrap", hook ? "font-mono text-[14px] [overflow-wrap:anywhere]" : "text-body")}>{request.detail}</blockquote>
        </>
      )}
      <dl className="mt-4 grid gap-x-5 gap-y-0.5 text-small sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-1.5">
        {request.resource && !hook && <><dt className="text-faint">{h.rows.item}</dt><dd className="mb-2 font-mono text-caption break-all sm:mb-0">{request.resource}</dd></>}
        {why && <><dt className="text-faint">{h.why}</dt><dd className="text-pretty">{why}</dd></>}
      </dl>
      <div className="mt-6 flex flex-wrap gap-2.5">
        <Button className={button} tabIndex={-1}>{h.allow}</Button>
        <Button variant="secondary" className={`${button} border-border`} tabIndex={-1}>{h.deny}</Button>
      </div>
      <p className="mt-5 text-caption text-faint">{h.promise} <span className="text-muted-foreground underline underline-offset-2">{h.change}</span></p>
      <p className="mt-2"><span className="-ml-1 inline-flex items-center gap-1 px-1 py-1 text-small text-muted-foreground"><ChevronRightIcon className="size-3.5" aria-hidden />{h.details}</span></p>
    </article>
  );
}

const TONE = { ran: "neutral", allowed: "neutral", approved: "neutral", blocked: "danger", rejected: "danger", needs_approval: "attention" } as const;

/** Decisions as the Approvals history and the Activity screen tabulate them (ui/decision-table.tsx), with the app's columns and words. */
export function DecisionRows({ rows, className }: { rows: DemoDecision[]; className?: string }) {
  const t = useT();
  const why = (d: DemoDecision) => (d.why.kind === "rule" ? t.timelinePage.rule(d.why.rule) : d.why.kind === "person" ? t.timelinePage.by.person : (t.timelinePage.reasons[d.why.reason] ?? d.why.reason));
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] text-left text-[14px]">
        <thead className="bg-[#fafafa] text-[13px] text-muted-foreground"><tr>{t.home.overview.columns.map((c) => <th key={c} scope="col" className="px-6 py-3 font-normal">{c}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((d) => (
            <tr key={d.time + d.detail}>
              <td className="px-6 py-3.5 whitespace-nowrap text-muted-foreground tabular-nums">{d.time}</td>
              <td className="px-6 py-3.5 font-medium">{d.agent.name}</td>
              <td className="px-6 py-3.5 font-mono text-[13px] [overflow-wrap:anywhere]">{d.detail}<span className="mt-0.5 block text-[12px] text-faint">{d.tool}.{d.action}</span></td>
              <td className="px-6 py-3.5"><Badge tone={TONE[d.outcome]}>{t.timelinePage.outcome[d.outcome]}</Badge></td>
              <td className="px-6 py-3.5 text-muted-foreground">{why(d)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
