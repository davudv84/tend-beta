"use client";

import { useEffect, useState } from "react";
import { ArrowRightIcon, ChevronDownIcon, KeyRoundIcon, ListChecksIcon, PlayIcon, ShieldCheckIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { SCENARIOS } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import { CHECKS, type CheckGroup, type CheckId, type CheckStatus } from "@/lib/verification";
import { BrandMark } from "@/ui/brand-mark";
import { Badge, buttonClass, type Tone } from "@/ui/primitives";
import { AppPanel, ExampleTag, prefersReducedMotion } from "../kit";

const STATUS_TONE: Record<CheckStatus, Tone> = { verified: "good", at_risk: "danger", not_verified: "neutral" };
/** The example's results: the notes tools aren't set up and nothing outside TEND can be seen, so those two can't be confirmed. */
const EXAMPLE: Record<CheckId, CheckStatus> = {
  folder_closed: "not_verified", alert_if_outside: "verified", history_approved: "verified", history_once: "verified", ever_outside: "verified",
  forbidden_refused: "verified", malformed_refused: "verified", ask_first_holds: "verified", rejection_holds: "verified", approval_once: "verified",
  agent_isolated: "not_verified",
};

/** An agent's checks as the app groups them, each opened to see what it shows and what it does not. Never a total. */
export function ChecksPanel() {
  const t = useT();
  const p = t.protection;
  const [open, setOpen] = useState<CheckId | null>("approval_once");
  return (
    <AppPanel title={`${p.title} · ops-agent`} icon={ShieldCheckIcon} right={<ExampleTag />}>
      <p className="border-b border-border px-4 py-3 text-[13px] text-muted-foreground">{p.intro}</p>
      {(Object.keys(CHECKS) as CheckGroup[]).map((g) => (
        <section key={g} aria-label={p.groups[g].title} className="border-b border-border last:border-b-0">
          <div className="bg-sunken/60 px-4 py-2.5"><p className="text-[13px] font-medium">{p.groups[g].title}</p><p className="text-[12px] text-muted-foreground">{p.groups[g].note}</p></div>
          <ul className="divide-y divide-border">
            {CHECKS[g].map((id) => {
              const on = open === id;
              const status = EXAMPLE[id];
              return (
                <li key={id}>
                  <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : id)} className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-white/[0.025] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
                    <span className="min-w-0 flex-1 text-[13px]">{p.checks[id].title}</span>
                    <Badge tone={STATUS_TONE[status]} className="h-5 text-[11px]">{p.status[status]}</Badge>
                    <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", on && "rotate-180")} strokeWidth={1.75} aria-hidden />
                  </button>
                  {on && (
                    <dl className="grid gap-3 px-4 pb-4 text-[13px] sm:grid-cols-2">
                      <div className="rounded-lg bg-sunken p-3"><dt className="text-[12px] font-medium">{p.shows}</dt><dd className="mt-1 text-muted-foreground">{p.checks[id].shows}</dd></div>
                      <div className="rounded-lg bg-sunken p-3"><dt className="text-[12px] font-medium">{p.notShow}</dt><dd className="mt-1 text-muted-foreground">{p.checks[id].notShow}</dd></div>
                      <p className="text-[12px] text-muted-foreground sm:col-span-2">{p.statusNote[status]}</p>
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </AppPanel>
  );
}

/** The seven scenarios every integration runs, run on the example one by one, only when asked. */
export function ScenariosPanel() {
  const t = useT();
  const s = t.front.kit.scenarios;
  const [done, setDone] = useState(0);
  const [started, setStarted] = useState(false);
  const running = started && done < SCENARIOS.length;
  useEffect(() => {
    if (!running) return;
    const id = window.setTimeout(() => setDone((n) => n + 1), prefersReducedMotion() ? 0 : 320);
    return () => clearTimeout(id);
  }, [running, done]);
  return (
    <AppPanel title={t.front.product.checks.a[0]} icon={ListChecksIcon} right={<ExampleTag />} bodyClassName="grid gap-3 p-4">
      <ol className="grid gap-1">
        {SCENARIOS.map((id, i) => (
          <li key={id} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-[13px]">
            <span aria-hidden className="grid size-5 place-items-center rounded-full border border-border text-[11px] text-muted-foreground tabular-nums">{i + 1}</span>
            <span className="flex-1">{t.integrations.scenarios[id]}</span>
            {i < done ? <Badge tone="good" className="h-5 text-[11px]">{s.passed}</Badge> : running && i === done ? <span className="text-[12px] text-muted-foreground">{s.running}</span> : <span className="text-[12px] text-faint">{s.waiting}</span>}
          </li>
        ))}
      </ol>
      <p aria-live="polite" className="min-h-5 text-[13px] font-medium text-primary">{done >= SCENARIOS.length ? s.done(SCENARIOS.length) : ""}</p>
      <button type="button" disabled={running || done >= SCENARIOS.length} onClick={() => setStarted(true)} className={cn(buttonClass(), "h-9 justify-self-start px-3 text-[13px]")}><PlayIcon className="size-3.5" strokeWidth={2} aria-hidden />{running ? s.running : s.run}</button>
    </AppPanel>
  );
}

/** Gateway mode drawn: the agent asks, TEND holds the key and calls the tool once. */
export function GatewayMini() {
  const t = useT();
  const g = t.front.kit.gateway;
  const box = "rounded-lg border border-border bg-surface px-3 py-2.5";
  return (
    <AppPanel title={t.front.everything.cards.gateway[0]} icon={KeyRoundIcon} bodyClassName="grid gap-2 p-4">
      <div className={box}><p className="text-[12px] font-medium">{g.agent}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{g.noKey}</p></div>
      <ArrowRightIcon aria-hidden className="mx-auto size-4 rotate-90 text-muted-foreground" strokeWidth={1.75} />
      <div className={cn(box, "flex items-center gap-2.5 border-primary/40")}>
        <span aria-hidden className="grid size-7 place-items-center rounded-md bg-[#ede8de] text-[#131211]"><BrandMark className="size-4" /></span>
        <span><span className="block text-[12px] font-medium tracking-[0.12em]">TEND</span><span className="flex items-center gap-1 text-[11px] text-primary"><KeyRoundIcon className="size-3" strokeWidth={2} aria-hidden />{g.key}</span></span>
      </div>
      <ArrowRightIcon aria-hidden className="mx-auto size-4 rotate-90 text-muted-foreground" strokeWidth={1.75} />
      <div className={box}><p className="text-[12px] font-medium">{g.tool}</p><p className="mt-0.5 font-mono text-[11px] text-muted-foreground">pay_invoice.pay · 1×</p></div>
    </AppPanel>
  );
}
