"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BellIcon, CheckIcon, CircleCheckIcon, InboxIcon, XIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/ui/brand-mark";
import { buttonClass } from "@/ui/primitives";
import { RequestCardView } from "@/ui/request-card-view";
import { AppPanel, ExampleTag } from "../kit";
import { ACTION, REQUESTS, agentOf, type DemoRequest, type RequestKey } from "../site-data";
import { AgentMark } from "./common";

type Answer = "allowed" | "denied";

/** One waiting request, drawn by the app's own card (ui/request-card-view.tsx) with invented words. */
function Card({ r, onDecide, className }: { r: DemoRequest; onDecide: (a: Answer) => void; className?: string }) {
  const t = useT();
  const h = t.home.request;
  const k = t.front.kit;
  const w = k.requests[r.key];
  const kind = r.kind === "send" ? t.front.demo.kinds.send : h.kind[r.kind];
  return (
    <RequestCardView
      className={className}
      kind={kind}
      loud={r.kind !== "send"}
      sentence={w.sentence}
      meta={h.asked(t.time.ago(r.askedMinutesAgo, "m"))}
      exact={{ label: h.exact, text: w.exact, mono: r.mono }}
      item={r.item ? { label: h.rows.item, value: r.item } : undefined}
      why={{ label: h.why, value: w.why }}
      labels={{ allow: h.allow, deny: h.deny, details: h.details, saving: h.saving, promise: h.promise }}
      onAllow={() => onDecide("allowed")}
      onDeny={() => onDecide("denied")}
      change={<Link href="/product/rules" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">{h.change}</Link>}
      details={[
        { label: t.front.demo.rows.agent, value: agentOf(r.agent).name },
        { label: t.front.demo.rows.tool, value: `${r.tool} · ${ACTION[r.tool]}`, mono: true },
      ]}
    />
  );
}

/**
 * Approvals as in the app: what waits on the left, the request in focus on the right. Answering one moves it to Answered and puts the
 * next one in focus; when nothing waits, it says so. Nothing new arrives.
 */
export function ApprovalsPanel() {
  const t = useT();
  const k = t.front.kit;
  const q = k.queue;
  const reduce = useReducedMotion();
  const [answers, setAnswers] = useState<Partial<Record<RequestKey, Answer>>>({});
  const waiting = REQUESTS.filter((r) => !answers[r.key]);
  const [picked, setPicked] = useState<RequestKey>("invoice");
  const focus = waiting.find((r) => r.key === picked) ?? waiting[0];
  const decideOne = (r: DemoRequest, a: Answer) => {
    setAnswers((s) => ({ ...s, [r.key]: a }));
    const next = waiting.find((x) => x.key !== r.key);
    if (next) setPicked(next.key);
  };
  return (
    <AppPanel title={t.ui.nav.approvals} icon={CircleCheckIcon} right={<><span className="tabular-nums">{q.waiting} · {waiting.length}</span><ExampleTag /></>} bodyClassName="grid grid-cols-1 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
      <div className="border-b border-border md:border-r md:border-b-0">
        <p className="px-4 pt-4 pb-2 text-[12px] font-medium text-muted-foreground">{q.waiting}</p>
        <ul className="grid gap-1 px-2">
          {waiting.map((r) => (
            <li key={r.key}>
              <button type="button" aria-current={focus?.key === r.key ? "true" : undefined} onClick={() => setPicked(r.key)} className={cn("flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-primary", focus?.key === r.key ? "bg-white/[0.06]" : "hover:bg-white/[0.03]")}>
                <AgentMark agent={r.agent} className="mt-0.5 size-6" />
                <span className="min-w-0"><span className="block truncate text-[13px] font-medium">{k.requests[r.key].sentence}</span><span className="block truncate text-[12px] text-muted-foreground">{t.time.ago(r.askedMinutesAgo, "m")}</span></span>
              </button>
            </li>
          ))}
          {!waiting.length && <li className="px-2 py-2.5 text-[13px] text-muted-foreground">{q.empty}</li>}
        </ul>
        {REQUESTS.some((r) => answers[r.key]) && (
          <>
            <p className="px-4 pt-5 pb-2 text-[12px] font-medium text-muted-foreground">{q.answered}</p>
            <ul className="grid gap-1 px-2 pb-4">
              {REQUESTS.filter((r) => answers[r.key]).map((r) => (
                <li key={r.key} className="flex items-start gap-3 px-2 py-2">
                  <AgentMark agent={r.agent} className="mt-0.5 size-6 opacity-70" />
                  <span className="min-w-0"><span className="block truncate text-[13px] text-muted-foreground">{k.requests[r.key].sentence}</span>
                    <span className={cn("mt-0.5 flex items-center gap-1 text-[12px] font-medium", answers[r.key] === "allowed" ? "text-primary" : "text-clay")}>{answers[r.key] === "allowed" ? <CheckIcon className="size-3" strokeWidth={2.5} aria-hidden /> : <XIcon className="size-3" strokeWidth={2.5} aria-hidden />}{answers[r.key] === "allowed" ? q.allowed : q.denied}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div aria-live="polite" className="min-h-[440px] p-4 md:p-6">
        <AnimatePresence mode="wait" initial={false}>
          {focus ? (
            <motion.div key={focus.key} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -8, transition: { duration: 0.18 } }}>
              <Card r={focus} onDecide={(a) => decideOne(focus, a)} />
            </motion.div>
          ) : (
            <motion.div key="clear" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="grid h-full min-h-[380px] place-items-center rounded-xl border border-dashed border-border text-center">
              <div><span className="mx-auto grid size-10 place-items-center rounded-full bg-primary/15 text-primary"><CheckIcon className="size-5" strokeWidth={2} aria-hidden /></span><p className="mt-4 text-[15px]">{q.empty}</p></div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppPanel>
  );
}

/** One request in small, answerable: for a card in the carousel and the platform section. */
export function ApprovalsMini({ request = "invoice" }: { request?: RequestKey }) {
  const t = useT();
  const k = t.front.kit;
  const h = t.home.request;
  const r = REQUESTS.find((x) => x.key === request)!;
  const [answer, setAnswer] = useState<Answer | null>(null);
  return (
    <AppPanel title={t.ui.nav.approvals} icon={InboxIcon} bodyClassName="grid gap-3 p-4">
      <p className="flex items-center gap-2 text-[12px] font-medium"><span aria-hidden className="size-1.5 rotate-45 bg-amber" />{t.home.dash.stats.waiting}</p>
      <p className="text-[14px] font-medium">{k.requests[r.key].sentence}</p>
      <p className="rounded-lg bg-sunken px-3 py-2 text-[12px]">{k.requests[r.key].exact}</p>
      <div aria-live="polite" className="min-h-10">
        {answer ? (
          <p className="flex h-10 items-center gap-2 text-[13px] font-medium">{answer === "allowed" ? <CheckIcon className="size-4 text-primary" strokeWidth={2} aria-hidden /> : <XIcon className="size-4 text-clay" strokeWidth={2} aria-hidden />}{answer === "allowed" ? t.front.demo.toast.allowed : t.front.demo.toast.denied}</p>
        ) : (
          <div className="flex gap-2"><button type="button" onClick={() => setAnswer("allowed")} className={cn(buttonClass(), "h-9 px-3 text-[13px]")}>{h.allow}</button><button type="button" onClick={() => setAnswer("denied")} className={cn(buttonClass("secondary"), "h-9 px-3 text-[13px]")}>{h.deny}</button></div>
        )}
      </div>
    </AppPanel>
  );
}

/** An approval works once, for exactly what was approved: the visitor sends the same request twice, or a changed one. */
export function ExactPanel() {
  const t = useT();
  const k = t.front.kit;
  const e = k.exact;
  type Try = { what: "same" | "changed"; result: "ran" | "used" | "changed" };
  const [tries, setTries] = useState<Try[]>([]);
  const used = tries.some((x) => x.result === "ran");
  const send = (what: Try["what"]) => setTries((xs) => [...xs, { what, result: what === "changed" ? "changed" : used ? "used" : "ran" }]);
  return (
    <AppPanel title={t.ui.nav.approvals} icon={CircleCheckIcon} right={<ExampleTag />} bodyClassName="grid gap-4 p-4">
      <div className="rounded-lg border border-border p-3">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-primary"><CheckIcon className="size-3.5" strokeWidth={2.5} aria-hidden />{e.approved}</p>
        <p className="mt-1.5 text-[13px]">{k.requests.invoice.exact}</p>
      </div>
      <div>
        <p className="text-[12px] font-medium text-muted-foreground">{e.agent}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => send("same")} className={cn(buttonClass("secondary"), "h-9 px-3 text-[13px]")}>{used ? e.twice : e.same}</button>
          <button type="button" onClick={() => send("changed")} className={cn(buttonClass("secondary"), "h-9 px-3 text-[13px]")}>{e.changed}</button>
        </div>
      </div>
      <ol aria-live="polite" className="grid min-h-[96px] content-start gap-1.5">
        {tries.map((x, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px]">
            {x.result === "ran" ? <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={2} aria-hidden /> : <XIcon className="mt-0.5 size-4 shrink-0 text-clay" strokeWidth={2} aria-hidden />}
            <span>{x.result === "ran" ? e.ranOnce : x.result === "used" ? e.usedUp : e.refusedChanged}</span>
          </li>
        ))}
      </ol>
    </AppPanel>
  );
}

/** A phone with TEND's notification: answer it right there. */
export function PhonePanel() {
  const t = useT();
  const k = t.front.kit;
  const h = t.home.request;
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="ui-next dark grid place-items-center !bg-transparent py-2" data-theme="dark">
      <div role="group" aria-label={k.phone.lock} className="relative w-[272px] overflow-hidden rounded-[36px] border border-white/[0.12] bg-[linear-gradient(180deg,#1f2a24,#121413_60%)] p-3 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)]">
        <div aria-hidden className="mx-auto mt-1 h-5 w-24 rounded-full bg-black" />
        <p aria-hidden className="mt-6 text-center text-[44px] leading-none font-light tracking-tight tabular-nums">14:02</p>
        <div className="mt-8 rounded-2xl bg-white/[0.1] p-3 backdrop-blur">
          <div className="flex items-center gap-2 text-[11px] text-white/70">
            <span className="grid size-5 place-items-center rounded-md bg-[#ede8de] text-[#131211]"><BrandMark className="size-3" /></span>
            <span className="flex-1 font-medium tracking-[0.12em]">TEND</span><span>{k.phone.now}</span>
          </div>
          <p className="mt-2 text-[13px] font-medium">{k.requests.invoice.sentence}</p>
          <p className="mt-0.5 text-[12px] text-white/70">{k.requests.invoice.exact}</p>
          <div aria-live="polite" className="mt-3">
            {answer ? (
              <p className="flex items-center gap-1.5 text-[12px] font-medium">{answer === "allowed" ? <CheckIcon className="size-3.5 text-primary" strokeWidth={2.5} aria-hidden /> : <XIcon className="size-3.5 text-clay" strokeWidth={2.5} aria-hidden />}{answer === "allowed" ? t.front.demo.toast.allowed : t.front.demo.toast.denied}</p>
            ) : open ? (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setAnswer("allowed")} className="h-9 rounded-lg bg-primary text-[12px] font-medium text-primary-foreground">{h.allow}</button>
                <button type="button" onClick={() => setAnswer("denied")} className="h-9 rounded-lg bg-white/[0.12] text-[12px] font-medium">{h.deny}</button>
              </div>
            ) : (
              <button type="button" onClick={() => setOpen(true)} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-white/[0.12] text-[12px] font-medium"><BellIcon className="size-3.5" strokeWidth={2} aria-hidden />{k.phone.open}</button>
            )}
          </div>
        </div>
        <div aria-hidden className="mx-auto mt-10 mb-1 h-1 w-24 rounded-full bg-white/40" />
      </div>
    </div>
  );
}
