"use client";

import { useState } from "react";
import { BlocksIcon, BotIcon, CheckIcon, PlugIcon } from "lucide-react";
import { IntegrationLogo } from "@/components/integration-logo";
import { useT } from "@/i18n/client";
import { INTEGRATIONS, statusOf, type Integration, type IntegrationId } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import { Badge, buttonClass, type Tone } from "@/ui/primitives";
import { AgentLines } from "../demo/agent-lines";
import { AppPanel, ExampleTag } from "../kit";

/** The agents as the app's list draws them (ui/agent-row.tsx), with the sample agents, and the list's "Connect another agent". */
export function AgentsPanel() {
  const t = useT();
  return (
    <AppPanel title={t.home.dash.agents} icon={BotIcon} right={<ExampleTag />} bodyClassName="p-0">
      <AgentLines />
      <p className="border-t border-border px-5 py-3.5 text-[14px] font-medium text-primary">{t.home.dash.add}</p>
    </AppPanel>
  );
}

const PICK: IntegrationId[] = ["claude", "openaiApi", "mcp", "http"];
type Ping = "allow" | "ask" | "never";

/**
 * The Connect page (app/(next)/connect/view.tsx) in small, step by step as it goes: choose how the agent connects, name it, set
 * "Send a test ping" (Continue waits until it may run), then answer the test request and read the result. Nothing is created.
 */
export function ConnectPanel() {
  const t = useT();
  const c = t.connect;
  const s3 = c.s3;
  const s4 = c.s4;
  const [step, setStep] = useState(1);
  const [via, setVia] = useState<IntegrationId | null>(null);
  const [name, setName] = useState("ops-agent");
  const [model, setModel] = useState("claude-haiku-4-5");
  const [ping, setPing] = useState<Ping>("never");
  const [answer, setAnswer] = useState<"approved" | "rejected" | null>(null);
  const testAllowed = ping !== "never";
  const result = ping === "allow" ? "approved" : answer;
  const restart = () => { setStep(1); setVia(null); setPing("never"); setAnswer(null); };
  return (
    <AppPanel title={t.ui.nav.integrations} icon={PlugIcon} right={<ExampleTag />} bodyClassName="grid gap-4 p-4">
      <div>
        <div aria-hidden className="grid grid-cols-4 gap-1.5">{c.steps.map((x, i) => <span key={x} className={cn("h-1 rounded-full", i < step ? "bg-primary" : "bg-border")} />)}</div>
        <p className="mt-2 text-[12px] text-muted-foreground" aria-live="polite">{c.stepOf(step, c.steps.length, c.steps[step - 1])}</p>
      </div>
      <div className="min-h-[190px]">
        {step === 1 && (
          <div className="grid gap-3">
            <p className="text-[14px] font-medium">{c.pick.title}</p>
            <ul className="grid grid-cols-2 gap-2">
              {PICK.map((id) => {
                const entry = INTEGRATIONS.find((x) => x.id === id)!;
                return (
                  <li key={id}>
                    <button type="button" onClick={() => { setVia(id); setStep(2); }} className="flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-left text-[13px] outline-none hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-primary">
                      <IntegrationLogo entry={entry} className="size-6 rounded-md" /><span className="min-w-0 truncate">{entry.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {step === 2 && (
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim() && model.trim()) setStep(3); }} className="grid gap-3">
            <p className="text-[14px] font-medium">{c.s1.title}</p>
            {via && <p className="text-[12px] text-muted-foreground">{c.pick.chosen(INTEGRATIONS.find((x) => x.id === via)!.name)}</p>}
            <label className="grid gap-1"><span className="text-[12px] font-medium">{c.s1.name}</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required className="h-9 rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus-visible:border-primary" /></label>
            <label className="grid gap-1"><span className="text-[12px] font-medium">{c.s1.model}</span><input value={model} onChange={(e) => setModel(e.target.value)} maxLength={60} placeholder={c.s1.modelHint} required className="h-9 rounded-lg border border-border bg-background px-3 font-mono text-[13px] outline-none focus-visible:border-primary" /></label>
            <button type="submit" className={cn(buttonClass(), "h-9 justify-self-start px-4 text-[13px]")}>{c.s1.create}</button>
          </form>
        )}
        {step === 3 && (
          <div className="grid gap-3">
            <p className="text-[14px] font-medium">{c.s2.title}</p>
            <div className="grid gap-2 border-y border-border py-3">
              <div><span className="text-[13px] font-medium">{t.tools.names.test_ping}</span><span className="ml-2 text-[12px] text-faint">{t.tools.risk.test}</span></div>
              <div role="radiogroup" aria-label={t.tools.groupLabel(t.tools.names.test_ping)} className="flex flex-wrap gap-2">
                {(["allow", "ask", "never"] as const).map((x) => <button key={x} type="button" role="radio" aria-checked={ping === x} onClick={() => setPing(x)} className={cn(buttonClass(ping === x ? "primary" : "secondary"), "h-8 px-3 text-[12px]")}>{t.tools.choice[x]}</button>)}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={!testAllowed} onClick={() => setStep(4)} className={cn(buttonClass(), "h-9 px-4 text-[13px]")}>{c.s2.next}</button>
              {!testAllowed && <p className="text-[12px] text-muted-foreground">{c.s2.needTest}</p>}
            </div>
          </div>
        )}
        {step === 4 && (
          <div aria-live="polite" className="grid gap-3">
            {!result ? (
              <div className="grid gap-2 rounded-lg border border-border p-3">
                <p className="text-[14px] font-medium">{s3.decisionTitle}</p>
                <p className="text-[12px] text-muted-foreground">{s3.decisionBody}</p>
                <p className="font-mono text-[12px] text-muted-foreground">{name || "ops-agent"} · test_ping.ping</p>
                <div className="flex gap-2"><button type="button" onClick={() => setAnswer("approved")} className={cn(buttonClass(), "h-8 px-3 text-[12px]")}>{s3.approve}</button><button type="button" onClick={() => setAnswer("rejected")} className={cn(buttonClass("secondary"), "h-8 px-3 text-[12px]")}>{s3.reject}</button></div>
              </div>
            ) : result === "approved" ? (
              <div className="grid gap-1.5"><p className="flex items-center gap-2 text-[14px] font-medium"><CheckIcon className="size-4 text-primary" strokeWidth={2} aria-hidden />{s4.verifiedTitle}</p><p className="text-[12px] text-muted-foreground">{s4.verifiedBody}</p></div>
            ) : (
              <div className="grid gap-1.5"><p className="text-[14px] font-medium">{s4.rejectedTitle}</p><p className="text-[12px] text-muted-foreground">{s4.rejectedBody}</p></div>
            )}
            {result && <button type="button" onClick={restart} className={cn(buttonClass("secondary"), "h-8 justify-self-start px-3 text-[12px]")}>{s4.again}</button>}
          </div>
        )}
      </div>
    </AppPanel>
  );
}

type Status = ReturnType<typeof statusOf>;
const STATUS_TONE: Record<Status, Tone> = { verified: "good", compatible: "attention", blocked: "neutral", planned: "neutral" };
const ORDER: Status[] = ["verified", "compatible", "blocked", "planned"];
export const groupOf = (i: Integration): Status => statusOf(i);

/** The integrations with the statuses the app's Integrations page uses (lib/integrations-catalog.ts statusOf), filterable by status. */
export function IntegrationsPanel({ small }: { small?: boolean }) {
  const t = useT();
  const s = t.integrations.status;
  const [only, setOnly] = useState<Status | "all">("all");
  const list = INTEGRATIONS.filter((i) => only === "all" || statusOf(i) === only);
  return (
    <AppPanel title={t.integrations.title} icon={BlocksIcon} right={small ? undefined : <ExampleTag />}>
      {!small && (
        <div role="radiogroup" aria-label={t.integrations.statusLabel} className="flex flex-wrap gap-1 border-b border-border p-3">
          {(["all", ...ORDER] as const).map((g) => (
            <button key={g} type="button" role="radio" aria-checked={only === g} onClick={() => setOnly(g)} className={cn("h-8 rounded-md px-2.5 text-[12px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-primary", only === g ? "bg-white/[0.08]" : "text-muted-foreground hover:text-foreground")}>
              {g === "all" ? t.integrations.all : s[g]} <span className="text-muted-foreground tabular-nums">{g === "all" ? INTEGRATIONS.length : INTEGRATIONS.filter((i) => statusOf(i) === g).length}</span>
            </button>
          ))}
        </div>
      )}
      <ul className={cn("grid", small ? "grid-cols-2" : "max-h-[340px] grid-cols-1 overflow-y-auto sm:grid-cols-2")}>
        {(small ? list.filter((i) => i.logo).slice(0, 6) : list).map((i) => {
          const g = statusOf(i);
          return (
            <li key={i.id} className="flex items-center gap-2.5 border-b border-border px-3 py-2 sm:odd:border-r">
              <IntegrationLogo entry={i} className="size-6 rounded-md" />
              <span className="min-w-0 flex-1 truncate text-[12px]">{i.name}</span>
              {small ? <span className={cn("shrink-0 text-[11px]", g === "verified" ? "text-primary" : "text-muted-foreground")}>{s[g]}</span> : <Badge tone={STATUS_TONE[g]} className="h-5 text-[10.5px]">{s[g]}</Badge>}
            </li>
          );
        })}
      </ul>
    </AppPanel>
  );
}
