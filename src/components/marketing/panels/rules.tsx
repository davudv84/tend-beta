"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { BracesIcon, CheckIcon, LoaderCircleIcon, LockIcon, ShieldIcon, XIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { Disclosure } from "@/ui/disclosure";
import { Badge, buttonClass, type Tone } from "@/ui/primitives";
import { AppPanel, ExampleTag, PrimaryLink, Terminal, useSeen } from "../kit";
import { ACTION, CALLER, CALLS, CENTRAL_POLICY, DEFAULT_RULES, RULED, SPEND, agentOf, decide, type ToolId, type Verdict } from "../site-data";
import { AgentMark, VerdictBadge } from "./common";

type Effect = "allow" | "approve" | "deny";
type Choice = "allow" | "ask" | "never";
type Risk = "read" | "write" | "spend" | "test";
const CHOICE_OF: Record<Effect, Choice> = { allow: "allow", approve: "ask", deny: "never" };
const EFFECT_OF: Record<Choice, Effect> = { allow: "allow", ask: "approve", never: "deny" };
const CHOICES: Choice[] = ["allow", "ask", "never"];
const GROUPS: [Effect, Tone][] = [["allow", "good"], ["approve", "attention"], ["deny", "danger"]];
const TOOL_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

/** ops-agent's sample policy, row by row as the server's PolicyView lists it: every gateway tool (server/gateway.ts) with its action and risk, plus one of the agent's own tools. */
interface PolicyTool { tool: string; action: string; risk: Risk; effect: Effect; custom?: boolean }
const OPS_POLICY: PolicyTool[] = [
  { tool: "pay_invoice", action: "execute", risk: "spend", effect: "approve" },
  { tool: "list_notes", action: "list", risk: "read", effect: "allow" },
  { tool: "read_note", action: "read", risk: "read", effect: "allow" },
  { tool: "write_note", action: "create", risk: "write", effect: "approve" },
  { tool: "read_test_file", action: "read", risk: "read", effect: "deny" },
  { tool: "write_test_file", action: "create", risk: "write", effect: "deny" },
  { tool: "delete_test_file", action: "delete", risk: "write", effect: "deny" },
  { tool: "test_ping", action: "ping", risk: "test", effect: "deny" },
  { tool: "send_email", action: "call", risk: "write", effect: "approve", custom: true },
];
/** How often ops-agent asked for each tool in the last 30 days (sample numbers), for the preview. */
const RECORDED: Record<string, number> = { pay_invoice: 3, list_notes: 14, read_note: 11, write_note: 6, send_email: 8 };
const rulesOf = (rows: PolicyTool[]) => rows.filter((r) => r.effect !== "deny" || r.custom).map((r) => ({ tool: r.tool, action: r.action, effect: r.effect }));

/**
 * One agent's policy as the app's Policies page draws it (app/(next)/policies/view.tsx): Can do, Needs approval and Never allowed, each
 * tool with its risk. "Edit policy" opens the app's editor (components/tool-permissions.tsx): a choice per tool (spending can't be set
 * to Allow), your agent's own tools, Save changes, and the preview against recorded actions, here computed from sample counts.
 */
export function RulesPanel() {
  const t = useT();
  const g = t.policiesPage;
  const p = t.tools;
  const [saved, setSaved] = useState<PolicyTool[]>(OPS_POLICY);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, Choice>>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [newTool, setNewTool] = useState("");
  const [sim, setSim] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rows: PolicyTool[] = [...saved, ...extra.filter((x) => !saved.some((r) => r.tool === x)).map((tool) => ({ tool, action: "call", risk: "write" as Risk, effect: "deny" as Effect, custom: true }))];
  const current = (r: PolicyTool) => draft[r.tool] ?? CHOICE_OF[r.effect];
  const changes = rows.filter((r) => draft[r.tool] !== undefined && (draft[r.tool] !== CHOICE_OF[r.effect] || extra.includes(r.tool)));
  const pick = (tool: string, c: Choice) => { setNotice(null); setSim(false); setDraft((d) => ({ ...d, [tool]: c })); };
  const proposed = rows.map((r) => ({ ...r, effect: EFFECT_OF[current(r)] }));
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const tool = newTool.trim();
    if (!TOOL_ID.test(tool) || rows.some((r) => r.tool === tool)) return;
    setExtra((x) => [...x, tool]); setDraft((d) => ({ ...d, [tool]: "ask" })); setNewTool(""); setSim(false);
  };
  const save = () => { setSaved(proposed); setDraft({}); setExtra([]); setSim(false); setNotice(p.saved); };
  const total = Object.values(RECORDED).reduce((a, b) => a + b, 0);
  const would = { allow: 0, approve: 0, deny: 0 };
  const changed: { tool: string; action: string; was: Effect; would: Effect; n: number }[] = [];
  for (const r of proposed) {
    const n = RECORDED[r.tool] ?? 0;
    would[r.effect] += n;
    const was = rows.find((x) => x.tool === r.tool)!.effect;
    if (n && was !== r.effect) changed.push({ tool: r.tool, action: r.action, was, would: r.effect, n });
  }
  return (
    <AppPanel title={g.title} icon={ShieldIcon} right={<ExampleTag />} bodyClassName="p-0">
      <header className="flex items-start justify-between gap-4 px-4 pt-4 pb-3 md:px-6">
        <div className="min-w-0">
          <h3 className="text-[18px] font-semibold tracking-[-0.01em]">{g.policyOf(agentOf("ops").name)}</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">{g.enforced}</p>
        </div>
        <button type="button" onClick={() => { if (!editing) setNotice(null); setEditing(!editing); setDraft({}); setExtra([]); setSim(false); }} className={cn(buttonClass("secondary"), "h-9 px-3 text-[13px]")}>{editing ? g.done : g.edit}</button>
      </header>
      {!editing ? (
        <>
          {GROUPS.map(([effect, tone]) => {
            const list = saved.filter((x) => x.effect === effect);
            return (
              <div key={effect} className="border-t border-border">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-sunken/60 px-4 py-2.5 md:px-6"><Badge tone={tone}>{g.groups[effect].title}</Badge><span className="text-[12px] text-muted-foreground">{list.length} · {g.groups[effect].note}</span></div>
                {list.length ? (
                  <ul className="divide-y divide-border">
                    {list.map((x) => (
                      <li key={x.tool} className="flex items-center justify-between gap-4 px-4 py-3 md:px-6">
                        <span className="min-w-0"><span className="block truncate text-[14px]">{p.names[x.tool] ?? x.tool}</span><span className="block truncate font-mono text-[12px] text-muted-foreground">{x.tool}.{x.action}</span></span>
                        <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">{x.custom && <span className="rounded-md bg-sunken px-2 py-0.5">{g.custom}</span>}<span className="hidden sm:inline">{p.risk[x.risk]}</span></span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="px-4 py-3 text-[13px] text-muted-foreground md:px-6">{g.empty}</p>}
              </div>
            );
          })}
          <p className="border-t border-border px-4 py-3 text-[13px] text-muted-foreground md:px-6">{g.blockedNote}</p>
          {notice && <p role="status" className="border-t border-border px-4 py-3 text-[13px] text-muted-foreground md:px-6">{notice}</p>}
        </>
      ) : (
        <div className="grid gap-4 border-t border-border px-4 py-4 md:px-6">
          <p className="text-[13px] text-muted-foreground">{p.intro}</p>
          <ul className="divide-y divide-border border-y border-border">
            {rows.map((r) => {
              const name = p.names[r.tool] ?? r.tool;
              const spend = r.risk === "spend";
              return (
                <li key={r.tool} className="grid gap-2 py-3">
                  <div><span className="text-[14px] font-medium">{name}</span><span className="ml-2 text-[12px] text-faint">{p.risk[r.risk]}</span></div>
                  <div role="radiogroup" aria-label={p.groupLabel(name)} className="flex flex-wrap gap-2">
                    {CHOICES.map((c) => {
                      const locked = spend && c === "allow";
                      const on = current(r) === c;
                      return <button key={c} type="button" role="radio" aria-checked={on} disabled={locked} onClick={() => pick(r.tool, c)} className={cn(buttonClass(on ? "primary" : "secondary"), "h-8 px-3 text-[13px]", locked && "opacity-50")}>{p.choice[c]}</button>;
                    })}
                  </div>
                  {spend && <p className="flex items-center gap-1.5 text-[12px] text-faint"><LockIcon className="size-3" aria-hidden /> {p.spendLocked}</p>}
                </li>
              );
            })}
          </ul>
          <form onSubmit={add} className="grid gap-1.5">
            <label htmlFor="own-tool" className="text-[13px] font-medium">{p.ownTitle}</label>
            <div className="flex gap-2">
              <input id="own-tool" value={newTool} onChange={(e) => setNewTool(e.target.value)} placeholder="send_sms" spellCheck={false} autoComplete="off" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-[13px] outline-none focus-visible:border-primary" />
              <button type="submit" disabled={!TOOL_ID.test(newTool.trim())} className={cn(buttonClass("secondary"), "h-9 px-3 text-[13px]")}>{p.ownAdd}</button>
            </div>
            <p className="text-[12px] text-faint">{p.ownHint}</p>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} disabled={!changes.length} className={cn(buttonClass(), "h-9 px-3 text-[13px]")}>{p.save}</button>
            <button type="button" onClick={() => setSim(true)} disabled={!changes.length} className={cn(buttonClass("secondary"), "h-9 px-3 text-[13px]")}>{p.simulate}</button>
            <span className="text-[12px] text-faint">{p.enforced}</span>
          </div>
          {sim && changes.length > 0 && (
            <section aria-label={p.simTitle} className="rounded-xl border border-border bg-sunken/40 px-4 py-3.5 text-[13px]">
              <h4 className="font-medium">{p.simTitle}</h4>
              <p className="mt-1 text-muted-foreground">{p.simSummary(total)}</p>
              <p className="mt-1 font-medium tabular-nums">{p.simCounts(would.allow, would.approve, would.deny)}</p>
              <p className="mt-2 text-muted-foreground">{p.simChanged(changed.reduce((a, x) => a + x.n, 0))}</p>
              {changed.length > 0 && (
                <ul className="mt-1.5 grid gap-1">
                  {changed.map((x) => <li key={x.tool} className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-[12px]">{x.tool}.{x.action}</span><span className="text-[12px] text-muted-foreground">{p.choice[CHOICE_OF[x.was]]} → <span className="font-medium text-foreground">{p.choice[CHOICE_OF[x.would]]}</span></span></li>)}
                </ul>
              )}
              <p className="mt-2 text-[12px] text-faint">{p.simNote}</p>
            </section>
          )}
          <p role="status" className="text-[13px] text-muted-foreground">{changes.length ? p.unsaved : ""}</p>
          <Disclosure summary={p.jsonTitle}>
            <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-[12px]">{JSON.stringify(rulesOf(proposed), null, 2)}</pre>
          </Disclosure>
        </div>
      )}
    </AppPanel>
  );
}

/** What TEND decided for one call; when it waits, Allow once and Don't allow, and for a payment the app's second question. */
function Outcome({ tool, verdict, answer, onAnswer }: { tool: ToolId; verdict: Verdict; answer: "ran" | "nothing" | null; onAnswer: (a: "ran" | "nothing") => void }) {
  const t = useT();
  const k = t.front.kit;
  const h = t.home.request;
  // The parent keys this by the call, so a new call starts without the second question.
  const [confirm, setConfirm] = useState(false);
  const spend = SPEND.includes(tool);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2"><VerdictBadge verdict={verdict} /><span className="font-mono text-[12px] text-muted-foreground">{tool}.{ACTION[tool]}</span></div>
      <p className="text-[14px] text-muted-foreground">{k.because[verdict]}</p>
      {verdict === "ask" && !answer && (confirm ? (
        <div className="grid gap-2 rounded-lg border border-border p-3">
          <p className="text-[14px] font-medium">{h.confirmTitle}</p>
          <p className="text-[13px] text-muted-foreground">{h.confirmSpend}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onAnswer("ran")} className={buttonClass()}>{h.confirm}</button>
            <button type="button" onClick={() => setConfirm(false)} className={buttonClass("secondary")}>{h.back}</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => (spend ? setConfirm(true) : onAnswer("ran"))} className={buttonClass()}>{h.allow}</button>
          <button type="button" onClick={() => onAnswer("nothing")} className={buttonClass("secondary")}>{h.deny}</button>
        </div>
      ))}
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
    <ul className={cn("grid grid-cols-[minmax(0,1fr)] gap-1.5", className)}>
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

/** Where one call is on its way through TEND; the homepage's headline over the card names it. */
export type Stage = "ask" | "check" | "decide" | "ran" | "blocked";

/**
 * The homepage's "Try a tool call": the visitor picks what an agent asks for, TEND checks the rules for a moment, and the answer
 * appears, with Allow once and Don't allow when it waits. With `autoplay` one call plays through by itself, once, when the card
 * scrolls into view (asked, checked, held, allowed), and stops for good as soon as the visitor picks or answers anything. Nothing
 * repeats on its own, and nothing plays under reduced motion.
 */
export function TryCall({ autoplay, onStage }: { autoplay?: boolean; onStage?: (stage: Stage) => void }) {
  const t = useT();
  const f = t.front;
  const k = f.kit;
  const reduce = useReducedMotion();
  const [tool, setTool] = useState<ToolId | null>(null);
  const [checking, setChecking] = useState(false);
  const [answer, setAnswer] = useState<"ran" | "nothing" | null>(null);
  const [ref, seen] = useSeen<HTMLDivElement>();
  const touched = useRef(false);
  useEffect(() => {
    if (!checking) return;
    const id = window.setTimeout(() => setChecking(false), reduce ? 0 : 750);
    return () => clearTimeout(id);
  }, [checking, reduce]);
  useEffect(() => {
    if (!autoplay || !seen || reduce) return;
    const ask = window.setTimeout(() => { if (!touched.current) { setTool("send_email"); setAnswer(null); setChecking(true); } }, 900);
    const allow = window.setTimeout(() => { if (!touched.current) setAnswer("ran"); }, 900 + 750 + 2200);
    return () => { clearTimeout(ask); clearTimeout(allow); };
  }, [autoplay, seen, reduce]);
  const pick = (x: ToolId) => { touched.current = true; setTool(x); setAnswer(null); setChecking(true); };
  const answerIt = (a: "ran" | "nothing") => { touched.current = true; setAnswer(a); };
  const verdict = tool ? decide(DEFAULT_RULES, tool) : null;
  const stage: Stage = !tool ? "ask" : checking ? "check" : verdict === "ask" && !answer ? "decide" : verdict === "allow" || answer === "ran" ? "ran" : "blocked";
  useEffect(() => onStage?.(stage), [stage, onStage]);
  return (
    <div ref={ref} className="ui-next dark grid grid-cols-1 gap-6 !bg-transparent md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-8" data-theme="dark">
      <div>
        <p className="text-[13px] font-medium text-muted-foreground">{f.tryCall.pick}</p>
        <CallList value={tool} onPick={pick} className="mt-3" />
      </div>
      <div className="grid content-start gap-4">
        <p className="flex items-center justify-between gap-2 text-[13px] font-medium text-muted-foreground">{f.tryCall.rules}<span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] font-normal">{k.illustration}</span></p>
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
              <m.p key="none" className="text-[14px] text-muted-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{f.tryCall.body}</m.p>
            ) : checking ? (
              <m.p key="checking" className="flex items-center gap-2 text-[14px] text-muted-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden />{f.tryCall.checking(RULED.length)}
              </m.p>
            ) : (
              <m.div key={`${tool}`} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid gap-3">
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><AgentMark agent={CALLER[tool]} className="size-5" />{f.tryCall.asks(agentOf(CALLER[tool]).name)}</p>
                <p className="rounded-lg bg-sunken px-3 py-2 text-[13px]">{k.calls[tool]}</p>
                <Outcome tool={tool} verdict={verdict!} answer={answer} onAnswer={answerIt} />
              </m.div>
            )}
          </AnimatePresence>
        </div>
        <PrimaryLink href="/product/rules" className="justify-self-start">{f.tryCall.button}</PrimaryLink>
      </div>
    </div>
  );
}

/** The address check of policy.ts (server/policy.ts ADDRESS): a plain address whose domain is exactly one that is listed. */
const ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@(([A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63})$/;
const CONDITION_RULES = [
  { tool: "send_email", action: "call", effect: "allow", when: { to: { emailDomainIn: ["yourco.example"] } } },
  { tool: "send_email", action: "call", effect: "approve" },
];

/**
 * A rule with a condition on its argument, where the app edits it: Rules as JSON (advanced), in the policy editor. The address field
 * under it is an illustration of what the server decides; the app has no tester.
 */
export function ConditionPanel() {
  const t = useT();
  const k = t.front.kit;
  const c = k.condition;
  const [to, setTo] = useState("");
  const value = to.trim();
  const match = ADDRESS.exec(value);
  const verdict: Verdict | null = !value ? null : match && match[1].toLowerCase() === "yourco.example" ? "allow" : "ask";
  return (
    <AppPanel title={t.tools.jsonTitle} icon={BracesIcon} right={<ExampleTag />} bodyClassName="grid gap-4 p-4">
      <p className="text-[12px] text-faint">{t.tools.jsonHint}</p>
      <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all">{`[\n${CONDITION_RULES.map((r) => `  ${JSON.stringify(r)}`).join(",\n")}\n]`}</pre>
      <div className="grid gap-3 rounded-lg border border-dashed border-border p-3">
        <label className="grid gap-1.5">
          <span className="flex items-center justify-between gap-2 text-[13px] font-medium">{c.label}<span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">{k.illustration}</span></span>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={c.placeholder} autoComplete="off" spellCheck={false} className="h-10 rounded-lg border border-border bg-background px-3 font-mono text-[13px] outline-none placeholder:text-faint focus-visible:border-primary" />
        </label>
        <div aria-live="polite" className="min-h-[52px]">
          {verdict ? (
            <div className="grid gap-1.5"><VerdictBadge verdict={verdict} className="justify-self-start" /><p className="text-[13px] text-muted-foreground">{!match ? c.invalid : verdict === "allow" ? c.own : c.other}</p></div>
          ) : <p className="text-[13px] text-muted-foreground">{c.empty}</p>}
        </div>
      </div>
    </AppPanel>
  );
}

/** Central policies have no screen: they are made, changed and assigned with the CLI (scripts/tend-cli.mjs), whose output this is. */
export function CentralPolicyPanel() {
  return <Terminal {...CENTRAL_POLICY} minHeight={220} />;
}
