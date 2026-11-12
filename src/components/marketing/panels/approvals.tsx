"use client";

import { useState } from "react";
import { CheckIcon, CircleCheckIcon, XIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import type { Outcome } from "@/lib/activity";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/ui/brand-mark";
import { DecisionRows, type DecisionRow } from "@/ui/decision-table";
import { buttonClass } from "@/ui/primitives";
import { HISTORY, INVOICE_REQUEST, OPS_AGENT, PUSH_REQUEST, REPO_HELPER } from "../demo-data";
import { SampleCard, type SampleRequest } from "../demo/sample-card";
import { AppPanel, ExampleTag } from "../kit";

type Answer = "allowed" | "denied";
const WAITING: { request: SampleRequest; agent: string; askedAt: string; lapsesAt: string }[] = [
  { request: INVOICE_REQUEST, agent: OPS_AGENT.name, askedAt: "14:02", lapsesAt: "14:10" },
  { request: PUSH_REQUEST, agent: REPO_HELPER.name, askedAt: "14:00", lapsesAt: "14:06" },
];

/**
 * Approvals as the app's page draws it (app/(next)/oversight/view.tsx): its tabs, "Waiting for a decision" with each request in the app's
 * own card (payments ask again before they are allowed), and the decision history with the app's columns and badges. Answering a
 * request moves it into the history; nothing new arrives.
 */
export function ApprovalsPanel() {
  const t = useT();
  const o = t.oversightPage;
  const g = t.timelinePage;
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const waiting = WAITING.filter((w) => !answers[w.request.id]);
  const answered: DecisionRow[] = WAITING.filter((w) => answers[w.request.id]).map((w) => {
    const outcome: Outcome = answers[w.request.id] === "allowed" ? "approved" : "rejected";
    return { key: w.request.id, time: w.askedAt, agent: w.agent, detail: w.request.detail, action: `${w.request.tool}.${w.request.action}`, outcome, path: ["needs_approval", outcome], reason: g.by.person };
  });
  const history: DecisionRow[] = [...answered, ...HISTORY.filter((h) => h.outcome === "rejected" || h.outcome === "approved").map((h, i) => ({ key: `h${i}`, time: h.time, agent: h.agent.name, detail: h.detail, action: `${h.tool}.${h.action}`, outcome: h.outcome, path: ["needs_approval", h.outcome] as Outcome[], reason: g.by.person }))];
  return (
    <AppPanel title={o.title} icon={CircleCheckIcon} right={<ExampleTag />} bodyClassName="p-4 md:p-6">
      <p className="text-[14px] text-muted-foreground">{o.description}</p>
      <div className="mt-4 flex flex-wrap gap-1 text-[13px]">
        {[o.tabs.authorizations, o.tabs.queue, o.tabs.log, o.tabs.controls, o.tabs.connected].map((label, i) => (
          <span key={label} className={cn("rounded-md px-2.5 py-1", i === 0 ? "bg-elevated font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
        ))}
      </div>
      <h3 className="mt-6 text-[16px] font-medium">{o.waitingTitle}</h3>
      <p className="mt-0.5 text-[13px] text-muted-foreground">{o.waitingSub}</p>
      <div aria-live="polite" className="mt-4 grid gap-4 lg:grid-cols-2">
        {waiting.map((w) => (
          <SampleCard key={w.request.id} request={w.request} agentName={w.agent} askedAt={w.askedAt} lapsesAt={w.lapsesAt} onAnswered={(a) => setAnswers((s) => ({ ...s, [w.request.id]: a }))} className="rounded-xl border border-border bg-surface p-5" />
        ))}
        {!waiting.length && <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[14px] text-muted-foreground lg:col-span-2">{o.nothingWaiting}</p>}
      </div>
      <h3 className="mt-8 text-[16px] font-medium">{o.historyTitle}</h3>
      <div className="-mx-4 mt-3 border-y border-border md:-mx-6"><DecisionRows rows={history} agents /></div>
    </AppPanel>
  );
}

/**
 * Illustration, not an app screen: the agent's side of one approval. The visitor plays the agent and sends the approved payment again,
 * or with a different amount; the answers are the ones TEND's API gives (docs/enforcement.md, docs/gateway.md), and in the app each
 * refusal shows up in Activity as an alert.
 */
export function ExactPanel() {
  const t = useT();
  const e = t.front.kit.exact;
  type Try = { what: "same" | "changed"; result: "ran" | "used" | "changed" };
  const [tries, setTries] = useState<Try[]>([]);
  const used = tries.some((x) => x.result === "ran");
  const send = (what: Try["what"]) => setTries((xs) => [...xs, { what, result: what === "changed" ? "changed" : used ? "used" : "ran" }]);
  return (
    <div className="ui-next dark rounded-xl border border-white/[0.09] bg-background p-4 text-foreground" data-theme="dark">
      <p className="flex items-center justify-between text-[12px] text-muted-foreground"><span>{e.title}</span><span className="rounded-md border border-border px-1.5 py-0.5 text-[11px]">{t.front.kit.illustration}</span></p>
      <div className="mt-3 rounded-lg border border-border p-3">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-primary"><CheckIcon className="size-3.5" strokeWidth={2.5} aria-hidden />{e.approved}</p>
        <p className="mt-1.5 font-mono text-[12.5px]">pay_invoice · {INVOICE_REQUEST.action} · {INVOICE_REQUEST.resource}</p>
        <p className="mt-0.5 font-mono text-[12.5px] text-muted-foreground">{INVOICE_REQUEST.detail}</p>
      </div>
      <p className="mt-4 text-[12px] font-medium text-muted-foreground">{e.agent}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => send("same")} className={cn(buttonClass("secondary"), "h-9 px-3 text-[13px]")}>{used ? e.twice : e.same}</button>
        <button type="button" onClick={() => send("changed")} className={cn(buttonClass("secondary"), "h-9 px-3 text-[13px]")}>{e.changed}</button>
      </div>
      <ol aria-live="polite" className="mt-4 grid min-h-[96px] content-start gap-1.5">
        {tries.map((x, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px]">
            {x.result === "ran" ? <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={2} aria-hidden /> : <XIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />}
            <span>{x.result === "ran" ? e.ranOnce : x.result === "used" ? e.usedUp : e.refusedChanged}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * TEND's Web Push notification on a locked phone, with its real words (server/push.ts): it says only that an approval is needed.
 * Tapping it opens TEND, where the request is answered in the app's own card.
 */
export function PhonePanel() {
  const t = useT();
  const k = t.front.kit;
  const p = t.notify.push.approval;
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  return (
    <div className="ui-next dark grid place-items-center !bg-transparent py-2" data-theme="dark">
      <div role="group" aria-label={k.phone.lock} className="relative w-[300px] overflow-hidden rounded-[40px] border border-white/[0.12] bg-[linear-gradient(180deg,#1f2a24,#121413_60%)] p-3 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)]">
        <div aria-hidden className="mx-auto mt-1 h-5 w-24 rounded-full bg-black" />
        {!open ? (
          <>
            <p aria-hidden className="mt-6 text-center text-[44px] leading-none font-light tracking-tight tabular-nums">14:02</p>
            <button type="button" onClick={() => setOpen(true)} className="mt-8 w-full rounded-2xl bg-white/[0.1] p-3 text-left backdrop-blur outline-none focus-visible:outline-2 focus-visible:outline-primary">
              <span className="flex items-center gap-2 text-[11px] text-white/70">
                <span className="grid size-5 place-items-center rounded-md bg-[#ede8de] text-[#131211]"><BrandMark className="size-3" /></span>
                <span className="flex-1 font-medium">tendhq.dev</span><span>{k.phone.now}</span>
              </span>
              <span className="mt-2 block text-[13px] font-medium">{p.title}</span>
              <span className="mt-0.5 block text-[12px] text-white/70">{p.body}</span>
            </button>
            <p className="mt-3 text-center text-[11px] text-white/50">{k.phone.tap}</p>
            <div aria-hidden className="h-24" />
          </>
        ) : (
          <div aria-live="polite" className="mt-4 [zoom:0.78]">
            {answer
              ? <p className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-6 text-[15px]">{answer === "allowed" ? <CheckIcon className="size-4 text-primary" strokeWidth={2} aria-hidden /> : <XIcon className="size-4 text-muted-foreground" strokeWidth={2} aria-hidden />}{answer === "allowed" ? t.home.request.allowed : t.home.request.denied}</p>
              : <SampleCard request={PUSH_REQUEST} agentName={REPO_HELPER.name} askedAt="14:02" lapsesAt="14:08" onAnswered={setAnswer} className="rounded-xl border border-border bg-surface p-4" />}
          </div>
        )}
        <div aria-hidden className="mx-auto mt-6 mb-1 h-1 w-24 rounded-full bg-white/40" />
      </div>
    </div>
  );
}
