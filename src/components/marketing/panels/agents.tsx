"use client";

import { useState } from "react";
import { BlocksIcon, BotIcon, CheckIcon, PlugIcon, SearchIcon, XIcon } from "lucide-react";
import { IntegrationLogo } from "@/components/integration-logo";
import { useT } from "@/i18n/client";
import { INTEGRATIONS, statusOf, type Integration } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import { Badge, buttonClass, type Tone } from "@/ui/primitives";
import { AppPanel, ExampleTag } from "../kit";
import { AGENTS, type AgentKey, type Choice } from "../site-data";
import { AgentMark, ChoicePicker } from "./common";

/** The agents as the app lists them: search, each with its status and what waits, and a key that can be revoked after one confirm. */
export function AgentsPanel() {
  const t = useT();
  const a = t.front.kit.agents;
  const [q, setQ] = useState("");
  const [revoked, setRevoked] = useState<Partial<Record<AgentKey, true>>>({});
  const [asking, setAsking] = useState<AgentKey | null>(null);
  const query = q.trim().toLowerCase();
  const list = AGENTS.filter((x) => !query || [x.name, a.roles[x.key]].some((s) => s.toLowerCase().includes(query)));
  return (
    <AppPanel title={t.ui.nav.assistants} icon={BotIcon} right={<ExampleTag />}>
      <div className="border-b border-border p-3">
        <label className="relative block">
          <span className="sr-only">{a.search}</span>
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint" strokeWidth={1.75} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={a.search} className="h-9 w-full rounded-lg border border-border bg-background pr-3 pl-8 text-[13px] outline-none placeholder:text-faint focus-visible:border-primary" />
        </label>
      </div>
      <ul className="divide-y divide-border">
        {list.map((x) => {
          const off = !!revoked[x.key];
          const tone: Tone = off ? "danger" : x.live ? "good" : "neutral";
          return (
            <li key={x.key} className="grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="flex min-w-0 items-start gap-3">
                <AgentMark agent={x.key} className={cn("mt-0.5 size-8", off && "opacity-50")} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2"><span className={cn("text-[14px] font-medium", off && "text-muted-foreground line-through")}>{x.name}</span><Badge tone={tone} className="h-5 text-[11px]">{off ? a.revoked : x.live ? a.running : a.idle}</Badge></p>
                  <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{a.roles[x.key]}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {off && x.waiting ? <span className="text-clay">{a.cancelled}</span> : x.waiting ? <span className="text-amber">{a.waiting(x.waiting)}</span> : a.last(t.time.ago(x.lastMinutes, "m"))}
                  </p>
                </div>
              </div>
              <div aria-live="polite" className="flex flex-wrap items-center gap-2 sm:justify-end">
                {off ? null : asking === x.key ? (
                  <>
                    <span className="max-w-[30ch] text-[12px] text-muted-foreground">{a.sure}</span>
                    <button type="button" onClick={() => { setRevoked((r) => ({ ...r, [x.key]: true })); setAsking(null); }} className={cn(buttonClass("danger"), "h-8 px-3 text-[12px]")}>{a.confirm}</button>
                    <button type="button" onClick={() => setAsking(null)} className={cn(buttonClass("secondary"), "h-8 px-3 text-[12px]")}>{a.cancel}</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setAsking(x.key)} className={cn(buttonClass("secondary"), "h-8 px-3 text-[12px]")}>{a.revoke}</button>
                )}
              </div>
            </li>
          );
        })}
        {!list.length && <li className="px-4 py-10 text-center text-[13px] text-muted-foreground">{a.none}</li>}
      </ul>
    </AppPanel>
  );
}

/** Three agents in small: for a card and the menu's preview. */
export function AgentsMini() {
  const t = useT();
  const a = t.front.kit.agents;
  const [revoked, setRevoked] = useState(false);
  return (
    <AppPanel title={t.ui.nav.assistants} icon={BotIcon}>
      <ul className="divide-y divide-border">
        {AGENTS.slice(0, 3).map((x, i) => {
          const off = i === 1 && revoked;
          return (
            <li key={x.key} className="flex items-center gap-2.5 px-3 py-2">
              <AgentMark agent={x.key} className={cn("size-6", off && "opacity-50")} />
              <span className={cn("min-w-0 flex-1 truncate text-[12px]", off && "text-muted-foreground line-through")}>{x.name}</span>
              {i === 1 ? (
                off ? <Badge tone="danger" className="h-5 text-[10.5px]">{a.revoked}</Badge>
                  : <button type="button" onClick={() => setRevoked(true)} className="h-6 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground">{a.revoke}</button>
              ) : <Badge tone="good" className="h-5 text-[10.5px]">{a.running}</Badge>}
            </li>
          );
        })}
      </ul>
    </AppPanel>
  );
}

/** The Connect page's four steps, in small: name it, choose what it may do, answer its test request, read the result. */
export function ConnectPanel() {
  const t = useT();
  const k = t.front.kit;
  const c = k.connect;
  const h = t.home.request;
  const [step, setStep] = useState(0);
  const [name, setName] = useState("ops-agent");
  const [ping, setPing] = useState<Choice>("ask");
  const [answered, setAnswered] = useState(false);
  return (
    <AppPanel title={t.ui.nav.integrations} icon={PlugIcon} right={<ExampleTag />} bodyClassName="grid gap-4 p-4">
      <ol className="grid grid-cols-4 gap-1.5">
        {c.steps.map((s, i) => (
          <li key={s}>
            <button type="button" onClick={() => setStep(i)} aria-current={step === i ? "step" : undefined} className="grid w-full gap-1.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-primary">
              <span className={cn("h-1 rounded-full", i <= step ? "bg-primary" : "bg-border")} />
              <span className={cn("truncate text-[11px]", step === i ? "font-medium text-foreground" : "text-muted-foreground")}>{i + 1}. {s}</span>
            </button>
          </li>
        ))}
      </ol>
      <div aria-live="polite" className="min-h-[150px] rounded-lg border border-border p-3">
        {step === 0 && (
          <label className="grid gap-1.5">
            <span className="text-[13px] font-medium">{c.create.label}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="h-9 rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus-visible:border-primary" />
            <span className="text-[12px] text-muted-foreground">{c.create.note}</span>
          </label>
        )}
        {step === 1 && (
          <div className="grid gap-3">
            <p className="text-[12px] text-muted-foreground">{c.permissions}</p>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13px]">{c.ping}</span><ChoicePicker tool="read_ticket" value={ping} onChange={setPing} label={c.ping} small /></div>
          </div>
        )}
        {step === 2 && (
          <div className="grid gap-3">
            <p className="text-[12px] text-muted-foreground">{c.test}</p>
            {ping === "never" ? <Badge tone="danger" className="justify-self-start">{k.verdict.never}</Badge> : ping === "allow" || answered ? (
              <p className="flex items-center gap-2 text-[13px] font-medium"><CheckIcon className="size-4 text-primary" strokeWidth={2} aria-hidden />{k.ran}</p>
            ) : (
              <div className="grid gap-2 rounded-lg bg-sunken p-3">
                <p className="text-[13px]">{name || "ops-agent"} · {c.ping}</p>
                <div className="flex gap-2"><button type="button" onClick={() => setAnswered(true)} className={cn(buttonClass(), "h-8 px-3 text-[12px]")}>{h.allow}</button><button type="button" onClick={() => setPing("never")} className={cn(buttonClass("secondary"), "h-8 px-3 text-[12px]")}>{h.deny}</button></div>
              </div>
            )}
          </div>
        )}
        {step === 3 && (
          ping !== "never" && (answered || ping === "allow")
            ? <div className="grid gap-2"><Badge tone="good" className="justify-self-start">{k.status.verified}</Badge><p className="text-[13px] text-muted-foreground">{c.result}</p></div>
            : <div className="grid gap-2"><Badge tone="danger" className="justify-self-start">{t.timelinePage.outcome.blocked}</Badge><p className="text-[13px] text-muted-foreground">{k.nothing}</p></div>
        )}
      </div>
      <div className="flex justify-between gap-2">
        <button type="button" disabled={step === 0} onClick={() => setStep((s) => s - 1)} className={cn(buttonClass("secondary"), "h-8 px-3 text-[12px]")}>{c.back}</button>
        <button type="button" disabled={step === 3} onClick={() => setStep((s) => s + 1)} className={cn(buttonClass(), "h-8 px-3 text-[12px]")}>{c.next}</button>
      </div>
    </AppPanel>
  );
}

type Group = "verified" | "next" | "planned";
export const groupOf = (i: Integration): Group => {
  const s = statusOf(i);
  return s === "verified" ? "verified" : s === "planned" ? "planned" : "next";
};
const GROUP_TONE: Record<Group, Tone> = { verified: "good", next: "attention", planned: "neutral" };

/** The integrations with their status from the last complete run (lib/integrations-catalog.ts), filterable by status. */
export function IntegrationsPanel({ small }: { small?: boolean }) {
  const t = useT();
  const k = t.front.kit;
  const [only, setOnly] = useState<Group | "all">("all");
  const list = INTEGRATIONS.filter((i) => only === "all" || groupOf(i) === only);
  return (
    <AppPanel title={t.front.everything.cards.integrations[0]} icon={BlocksIcon} right={small ? undefined : <ExampleTag />}>
      {!small && (
        <div role="radiogroup" aria-label={t.front.everything.cards.integrations[0]} className="flex flex-wrap gap-1 border-b border-border p-3">
          {(["all", "verified", "next", "planned"] as const).map((g) => (
            <button key={g} type="button" role="radio" aria-checked={only === g} onClick={() => setOnly(g)} className={cn("h-8 rounded-md px-2.5 text-[12px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-primary", only === g ? "bg-white/[0.08]" : "text-muted-foreground hover:text-foreground")}>
              {g === "all" ? k.log.all : k.status[g]} <span className="text-muted-foreground tabular-nums">{g === "all" ? INTEGRATIONS.length : INTEGRATIONS.filter((i) => groupOf(i) === g).length}</span>
            </button>
          ))}
        </div>
      )}
      <ul className={cn("grid", small ? "grid-cols-2" : "max-h-[340px] grid-cols-1 overflow-y-auto sm:grid-cols-2")}>
        {(small ? list.filter((i) => i.logo).slice(0, 6) : list).map((i) => {
          const g = groupOf(i);
          return (
            <li key={i.id} className="flex items-center gap-2.5 border-b border-border px-3 py-2 sm:odd:border-r">
              <IntegrationLogo entry={i} className="size-6 rounded-md" />
              <span className="min-w-0 flex-1 truncate text-[12px]">{i.name}</span>
              {!small && <Badge tone={GROUP_TONE[g]} className="h-5 text-[10.5px]">{k.status[g]}</Badge>}
              {small && g === "verified" && <CheckIcon className="size-3.5 text-primary" strokeWidth={2.5} aria-label={k.status.verified} />}
              {small && g !== "verified" && <XIcon className="size-3.5 text-muted-foreground" strokeWidth={2} aria-label={k.status[g]} />}
            </li>
          );
        })}
      </ul>
    </AppPanel>
  );
}
