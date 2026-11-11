"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AtSignIcon, CheckIcon, ListChecksIcon, LoaderCircleIcon, ShieldIcon, XIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/ui/primitives";
import { AppPanel, ExampleTag, PrimaryLink } from "../kit";
import { ACTION, AGENTS, CALLER, CALLS, DEFAULT_RULES, RULED, agentOf, decide, type Choice, type RuledTool, type ToolId, type Verdict } from "../site-data";
import { AgentMark, ChoicePicker, VerdictBadge } from "./common";

/** One tool with its rule: the plain name, the recorded name, and the choice. */
function RuleRow({ tool, value, onChange, small }: { tool: RuledTool; value: Choice; onChange: (c: Choice) => void; small?: boolean }) {
  const k = useT().front.kit;
  return (
    <li className={cn("flex justify-between gap-3", small ? "flex-col items-start gap-1.5 px-3 py-2" : "items-center px-4 py-3")}>
      <span className="min-w-0">
        <span className={cn("truncate", small ? "text-[12px]" : "block text-[14px]")}>{k.tools[tool]}</span>
        <span className={cn("truncate font-mono text-muted-foreground", small ? "ml-2 text-[10.5px]" : "block text-[12px]")}>{tool}.{ACTION[tool]}</span>
      </span>
      <ChoicePicker tool={tool} value={value} onChange={onChange} label={k.tools[tool]} small={small} />
    </li>
  );
}

/** What TEND decided for one call, and, when it waits, the two answers. */
function Outcome({ tool, verdict, answer, onAnswer }: { tool: ToolId; verdict: Verdict; answer: "ran" | "nothing" | null; onAnswer: (a: "ran" | "nothing") => void }) {
  const t = useT();
  const k = t.front.kit;
  const h = t.home.request;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2"><VerdictBadge verdict={verdict} /><span className="font-mono text-[12px] text-muted-foreground">{tool}.{ACTION[tool]}</span></div>
      <p className="text-[14px] text-muted-foreground">{k.because[verdict]}</p>
      {verdict === "ask" && !answer && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onAnswer("ran")} className={buttonClass()}>{h.allow}</button>
          <button type="button" onClick={() => onAnswer("nothing")} className={buttonClass("secondary")}>{h.deny}</button>
        </div>
      )}
      {(verdict === "allow" || answer) && (
        <p role="status" className="flex items-center gap-2 text-[14px] font-medium">
          {verdict === "allow" || answer === "ran" ? <CheckIcon className="size-4 text-primary" strokeWidth={2} aria-hidden /> : <XIcon className="size-4 text-clay" strokeWidth={2} aria-hidden />}
          {verdict === "allow" || answer === "ran" ? k.ran : k.nothing}
        </p>
      )}
      {(verdict === "never" || verdict === "unlisted") && <p role="status" className="flex items-center gap-2 text-[14px] font-medium"><XIcon className="size-4 text-clay" strokeWidth={2} aria-hidden />{k.nothing}</p>}
    </div>
  );
}

/** The calls to test, as a list of choices. */
function CallList({ value, onPick, className }: { value: ToolId | null; onPick: (tool: ToolId) => void; className?: string }) {
  const k = useT().front.kit;
  return (
    <ul className={cn("grid gap-1.5", className)}>
      {CALLS.map((tool) => {
        const on = value === tool;
        return (
          <li key={tool}>
            <button type="button" aria-pressed={on} onClick={() => onPick(tool)} className={cn("flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-primary", on ? "border-primary/50 bg-accent" : "border-border hover:bg-white/[0.03]")}>
              <AgentMark agent={CALLER[tool]} className="size-6" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{k.calls[tool]}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{agentOf(CALLER[tool]).name} · <span className="font-mono">{tool}.{ACTION[tool]}</span></span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Rules for one agent on the left, a call to test on the right. Changing a rule changes what the test decides, at once. */
export function RulesPanel() {
  const t = useT();
  const k = t.front.kit;
  const [rules, setRules] = useState<Record<RuledTool, Choice>>(DEFAULT_RULES);
  const [tool, setTool] = useState<ToolId>("send_email");
  const [answer, setAnswer] = useState<"ran" | "nothing" | null>(null);
  const verdict = decide(rules, tool);
  const set = (x: RuledTool, c: Choice) => { setRules((r) => ({ ...r, [x]: c })); setAnswer(null); };
  return (
    <AppPanel title={k.policyOf(AGENTS[0].name)} icon={ShieldIcon} right={<ExampleTag />} bodyClassName="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="border-b border-border lg:border-r lg:border-b-0">
        <ul className="divide-y divide-border">{RULED.map((x) => <RuleRow key={x} tool={x} value={rules[x]} onChange={(c) => set(x, c)} />)}</ul>
        <p className="border-t border-border px-4 py-3 text-[13px] text-muted-foreground">{k.unlistedNote} {k.spendLocked}</p>
      </div>
      <div className="grid content-start gap-4 p-4">
        <p className="text-[13px] font-medium">{k.test}</p>
        <CallList value={tool} onPick={(x) => { setTool(x); setAnswer(null); }} />
        <div aria-live="polite" className="rounded-lg border border-border bg-surface p-4">
          <Outcome tool={tool} verdict={verdict} answer={answer} onAnswer={setAnswer} />
        </div>
      </div>
    </AppPanel>
  );
}

/** Three rules in small, still changeable: for a card in the carousel and the menu's preview. */
export function RulesMini() {
  const k = useT().front.kit;
  const [rules, setRules] = useState<Record<RuledTool, Choice>>(DEFAULT_RULES);
  return (
    <AppPanel title={k.policyOf(AGENTS[0].name)} icon={ShieldIcon}>
      <ul className="divide-y divide-border">{(["read_ticket", "send_email", "delete_record"] as const).map((x) => <RuleRow key={x} small tool={x} value={rules[x]} onChange={(c) => setRules((r) => ({ ...r, [x]: c }))} />)}</ul>
      <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">{k.unlistedNote}</p>
    </AppPanel>
  );
}

/**
 * The homepage's "Try a tool call": the visitor picks what an agent asks for, TEND checks the rules for a moment, and the answer
 * appears, with Allow once and Don't allow when it waits. Nothing repeats on its own.
 */
export function TryCall() {
  const t = useT();
  const f = t.front;
  const k = f.kit;
  const reduce = useReducedMotion();
  const [tool, setTool] = useState<ToolId | null>(null);
  const [checking, setChecking] = useState(false);
  const [answer, setAnswer] = useState<"ran" | "nothing" | null>(null);
  useEffect(() => {
    if (!checking) return;
    const id = window.setTimeout(() => setChecking(false), reduce ? 0 : 750);
    return () => clearTimeout(id);
  }, [checking, reduce]);
  const pick = (x: ToolId) => { setTool(x); setAnswer(null); setChecking(true); };
  const verdict = tool ? decide(DEFAULT_RULES, tool) : null;
  return (
    <div className="ui-next dark grid grid-cols-1 gap-6 !bg-transparent md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-8" data-theme="dark">
      <div>
        <p className="text-[13px] font-medium text-muted-foreground">{f.tryCall.pick}</p>
        <CallList value={tool} onPick={pick} className="mt-3" />
      </div>
      <div className="grid content-start gap-4">
        <p className="text-[13px] font-medium text-muted-foreground">{f.tryCall.rules}</p>
        <ul className="grid gap-1 rounded-lg border border-border bg-background p-3 font-mono text-[12px]">
          {RULED.map((x) => (
            <li key={x} className={cn("flex items-center justify-between gap-3 rounded px-2 py-1", tool === x && !checking && "bg-white/[0.05]")}>
              <span className="truncate">{x}.{ACTION[x]}</span><span className="text-muted-foreground">{t.tools.choice[DEFAULT_RULES[x]]}</span>
            </li>
          ))}
          <li className={cn("flex items-center justify-between gap-3 rounded px-2 py-1 text-muted-foreground", tool === "database" && !checking && "bg-white/[0.05]")}><span>*</span><span>{k.verdict.unlisted}</span></li>
        </ul>
        <div aria-live="polite" className="min-h-[168px] rounded-xl border border-border bg-background p-4">
          <AnimatePresence mode="wait" initial={false}>
            {!tool ? (
              <motion.p key="none" className="text-[14px] text-muted-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{f.tryCall.body}</motion.p>
            ) : checking ? (
              <motion.p key="checking" className="flex items-center gap-2 text-[14px] text-muted-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden />{f.tryCall.checking(RULED.length)}
              </motion.p>
            ) : (
              <motion.div key={`${tool}`} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid gap-3">
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><AgentMark agent={CALLER[tool]} className="size-5" />{f.tryCall.asks(agentOf(CALLER[tool]).name)}</p>
                <p className="rounded-lg bg-sunken px-3 py-2 text-[13px]">{k.calls[tool]}</p>
                <Outcome tool={tool} verdict={verdict!} answer={answer} onAnswer={setAnswer} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <PrimaryLink href="/product/rules" className="justify-self-start">{f.tryCall.button}</PrimaryLink>
      </div>
    </div>
  );
}

/** A rule with a condition on its argument: the visitor types an address and sees what TEND decides. */
export function ConditionPanel() {
  const k = useT().front.kit;
  const c = k.condition;
  const [to, setTo] = useState("");
  const value = to.trim().toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const verdict: Verdict | null = !value ? null : valid && value.endsWith("@yourco.example") ? "allow" : "ask";
  return (
    <AppPanel title={k.tools.send_email} icon={AtSignIcon} right={<ExampleTag />} bodyClassName="grid gap-4 p-4">
      <p className="rounded-lg bg-sunken px-3 py-2 font-mono text-[12px] leading-relaxed">{c.rule}</p>
      <label className="grid gap-1.5">
        <span className="text-[13px] font-medium">{c.label}</span>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={c.placeholder} autoComplete="off" spellCheck={false} className="h-10 rounded-lg border border-border bg-background px-3 font-mono text-[13px] outline-none placeholder:text-faint focus-visible:border-primary" />
      </label>
      <div aria-live="polite" className="min-h-[52px]">
        {verdict ? (
          <div className="grid gap-1.5"><VerdictBadge verdict={verdict} className="justify-self-start" /><p className="text-[13px] text-muted-foreground">{!valid ? c.invalid : verdict === "allow" ? c.own : c.other}</p></div>
        ) : <p className="text-[13px] text-muted-foreground">{c.empty}</p>}
      </div>
    </AppPanel>
  );
}

/** One central policy assigned to several agents: one change, in force for each assigned agent at once. */
export function CentralPolicyPanel() {
  const t = useT();
  const k = t.front.kit;
  const c = k.central;
  const [choice, setChoice] = useState<Choice>("ask");
  const [version, setVersion] = useState(1);
  const [assigned, setAssigned] = useState<Record<string, boolean>>({ ops: true, repo: false, support: true, research: true });
  const n = Object.values(assigned).filter(Boolean).length;
  return (
    <AppPanel title={c.name} icon={ListChecksIcon} right={<><span>{c.version(version)}</span><ExampleTag /></>} bodyClassName="grid gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
        <span className="min-w-0"><span className="block text-[13px]">{c.rule}</span><span className="block font-mono text-[11px] text-muted-foreground">send_email.send</span></span>
        <ChoicePicker tool="send_email" value={choice} onChange={(x) => { if (x !== choice) { setChoice(x); setVersion((v) => v + 1); } }} label={c.rule} small />
      </div>
      <div>
        <p className="text-[13px] font-medium">{c.assigned(n)}</p>
        <ul className="mt-2 grid gap-1">
          {AGENTS.map((a) => (
            <li key={a.key}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                <input type="checkbox" checked={!!assigned[a.key]} onChange={(e) => setAssigned((s) => ({ ...s, [a.key]: e.target.checked }))} className="size-4 accent-[#8dbba5]" />
                <AgentMark agent={a.key} className="size-6" />
                <span className="flex-1 text-[13px]">{a.name}</span>
                {assigned[a.key] && <VerdictBadge verdict={choice} className="h-5 text-[11px]" />}
              </label>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[12px] text-muted-foreground">{c.live} {c.stricter}</p>
    </AppPanel>
  );
}
