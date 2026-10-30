"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, CopyIcon, InfoIcon, KeyRoundIcon, XIcon } from "lucide-react";
import { IntegrationLogo } from "@/components/integration-logo";
import { PushStatusLine, usePushState } from "@/components/notification-settings";
import { SignIn } from "@/components/sign-in";
import { useT } from "@/i18n/client";
import { errorText, type Dict } from "@/i18n";
import { TEST_COMMAND, TEST_SCRIPT, VERIFY_COMMAND, agentSnippet, envCommand, maskedEnv } from "@/lib/connect-snippet";
import { INTEGRATIONS, STATUS_ORDER, statusOf } from "@/lib/integrations-catalog";
import { TEST_TOOL, testState } from "@/lib/onboarding";
import { applyChoices, choiceOf, type PolicyView } from "@/lib/permissions";
import { call, useStore } from "@/lib/store";
import type { Agent, Provider } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/format";
import { BrandMark } from "@/ui/brand-mark";
import { Disclosure } from "@/ui/disclosure";
import { buttonClass } from "@/ui/primitives";
import { useUiPrefs } from "@/ui/prefs-context";
import { useDocumentTheme } from "@/ui/theme";

// The first-run guide. Every "done" on this page is something the server recorded: the agent's authenticated call (its presence), the policy
// as saved, the authorization and the gateway's own record of running the tool. The page only shows them; it never assumes one.

type Step = "welcome" | "connect" | "verify" | "policy" | "test" | "notifications" | "done";
const ORDER: Step[] = ["welcome", "connect", "verify", "policy", "test", "notifications", "done"];
type Effect = "approve" | "allow" | "deny";
interface Guide {
  available: true; step: Step; integration: string | null; agent: { id: string; name: string } | null;
  startedAt: number | null; completedAt: number | null; skippedAt: number | null;
  checks: { agent: boolean; connectedAt: number | null; policy: Effect | null; test: { outcome: "ran" | "rejected" | "blocked"; at: number; authorizationId: string } | null; notifications: "enabled" | "later" | null };
}
type GuideResponse = Guide | { available: false };

// Implemented integrations, verified first; within a status, the ones most people start with.
const FIRST = ["claudeCode", "claude", "openai", "mcp"];
const CONNECTABLE = INTEGRATIONS.filter((i) => i.connect).map((i) => ({ ...i, status: statusOf(i) }))
  .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (FIRST.indexOf(a.id) + 1 || 99) - (FIRST.indexOf(b.id) + 1 || 99));

const time = (t: Dict, at: number) => new Date(at).toLocaleTimeString(t.intl.time);

/** Where to resume: the saved step, but never one that needs an agent when there is none. */
function startStep(g: Guide): Step {
  if (g.completedAt || (g.step === "notifications" && g.checks.notifications)) return "done";
  if (ORDER.indexOf(g.step) >= ORDER.indexOf("verify") && !g.agent) return "connect";
  return g.step;
}

// ---- building blocks ---------------------------------------------------------------------------------

function useCopy() {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600);
    } catch {
      toast.error(t.onboarding.copyFailed);
    }
  };
  return { copied, copy };
}

/** A command or snippet: what is shown can differ from what is copied (the key is copied, never displayed). */
function CodeBlock({ id, label, shown, text, copy }: { id: string; label?: string; shown: string; text: string; copy: ReturnType<typeof useCopy> }) {
  const t = useT();
  const done = copy.copied === id;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-sunken/60">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <span className="truncate text-[12px] font-medium text-muted-foreground">{label}</span>
        <button type="button" onClick={() => void copy.copy(id, text)}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-foreground outline-none transition-colors hover:bg-black/[0.05] focus-visible:outline-2 focus-visible:outline-primary dark:hover:bg-white/[0.08]">
          {done ? <CheckIcon className="size-3.5 text-primary" aria-hidden /> : <CopyIcon className="size-3.5" aria-hidden />}
          <span aria-live="polite">{done ? t.onboarding.copied : t.onboarding.copy}</span>
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed"><code>{shown}</code></pre>
    </div>
  );
}

function StepHeader({ step, title, body, headingRef }: { step: Step; title: string; body?: string; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const t = useT();
  return (
    <header>
      <p className="text-[12px] font-medium tracking-[0.08em] text-primary uppercase">{t.onboarding.steps[step]}</p>
      <h1 ref={headingRef} tabIndex={-1} className="mt-3 text-section text-balance outline-none">{title}</h1>
      {body && <p className="mt-4 max-w-[58ch] text-lead text-pretty text-muted-foreground">{body}</p>}
    </header>
  );
}

function Actions({ onBack, children }: { onBack?: () => void; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="mt-12 flex flex-wrap-reverse items-center justify-between gap-3 border-t border-border pt-6">
      {onBack ? (
        <button type="button" onClick={onBack} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-[14px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
          <ArrowLeftIcon className="size-4" aria-hidden />{t.onboarding.back}
        </button>
      ) : <span />}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const primary = cn(buttonClass(), "h-11 px-5");
const secondary = cn(buttonClass("secondary"), "h-11 px-5");

type RowState = "done" | "active" | "todo" | "failed";
function CheckRow({ state, children }: { state: RowState; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2.5 text-[14px]">
      <span aria-hidden className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-300",
        state === "done" && "border-primary bg-primary text-primary-foreground", state === "active" && "border-primary", state === "todo" && "border-border", state === "failed" && "border-[#b42318] bg-[#b42318] text-white")}>
        {state === "done" && <CheckIcon className="size-3" strokeWidth={3} />}
        {state === "failed" && <XIcon className="size-3" strokeWidth={3} />}
        {state === "active" && <span className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" />}
      </span>
      <span className={cn("min-w-0", state === "todo" ? "text-faint" : "text-foreground")}>{children}</span>
    </li>
  );
}

function Frame({ step, onSkip, children }: { step: Step; onSkip?: () => void; children: React.ReactNode }) {
  const t = useT();
  const o = t.onboarding;
  const [prefs] = useUiPrefs();
  useDocumentTheme(prefs.theme);
  const i = ORDER.indexOf(step);
  return (
    <div className="ui-next min-h-dvh bg-background" data-theme={prefs.theme}>
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1080px] items-center justify-between gap-4 px-4 md:px-8">
          <span className="flex items-center gap-2.5"><BrandMark className="size-6 text-primary" /><span className="text-[15px] font-semibold tracking-[0.16em]">TEND</span></span>
          {onSkip && <button type="button" onClick={onSkip} className="rounded-md px-2 py-1 text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">{o.skip}</button>}
        </div>
        <nav aria-label={o.progress} className="mx-auto max-w-[1080px] px-4 pb-3 md:px-8">
          <p className="text-[12px] text-muted-foreground md:hidden">{o.stepOf(i + 1, ORDER.length)} · {o.steps[step]}</p>
          <div aria-hidden className="mt-2 h-0.5 overflow-hidden rounded-full bg-border md:hidden">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${((i + 1) / ORDER.length) * 100}%` }} />
          </div>
          <ol className="hidden items-center gap-2 md:flex">
            {ORDER.map((s, k) => (
              <li key={s} aria-current={k === i ? "step" : undefined} className={cn("flex items-center gap-2 text-[12px]", k < ORDER.length - 1 && "flex-1")}>
                <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border text-[11px] tabular-nums transition-colors duration-300",
                  k < i && "border-primary bg-primary text-primary-foreground", k === i && "border-primary font-medium text-primary", k > i && "border-border text-faint")}>
                  {k < i ? <CheckIcon className="size-3" strokeWidth={3} aria-hidden /> : k + 1}
                </span>
                <span className={cn("whitespace-nowrap", k === i ? "font-medium text-foreground" : k < i ? "text-muted-foreground" : "text-faint")}>{o.steps[s]}</span>
                {k < ORDER.length - 1 && <span aria-hidden className={cn("h-px min-w-3 flex-1", k < i ? "bg-primary/50" : "bg-border")} />}
              </li>
            ))}
          </ol>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-[720px] px-4 pt-10 pb-24 md:px-8 md:pt-14">{children}</main>
    </div>
  );
}

// ---- the page ------------------------------------------------------------------------------------------

export default function View() {
  const t = useT();
  const o = t.onboarding;
  const status = useStore((s) => s.status);
  const ready = useStore((s) => s.ready);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const [guide, setGuide] = useState<GuideResponse | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!canAct) return;
    let live = true;
    void call<GuideResponse>("/api/v1/onboarding", undefined, "GET").then((r) => {
      if (!live) return;
      if (r.ok) { setGuide(r.data); setFailed(null); } else setFailed(errorText(t, r));
    });
    return () => { live = false; };
  }, [canAct, t, attempt]);

  if (status === "signin" || (ready && !canAct)) return <Frame step="welcome"><div className="max-w-sm"><SignIn compact /></div></Frame>;
  if (failed)
    return (
      <Frame step="welcome">
        <p role="alert" className="text-[15px] text-[#b42318]">{o.saveFailed} {failed}</p>
        <button type="button" className={cn(secondary, "mt-6")} onClick={() => setAttempt((n) => n + 1)}>{t.tools.retry}</button>
      </Frame>
    );
  if (!ready || !guide) return <Frame step="welcome"><div aria-busy="true" aria-label={o.loading} className="grid gap-4"><div className="h-4 w-24 rounded bg-sunken" /><div className="h-10 w-3/4 rounded-xl bg-sunken" /><div className="h-5 w-2/3 rounded-lg bg-sunken" /></div></Frame>;
  if (!guide.available)
    return <Frame step="welcome"><p className="text-lead text-muted-foreground">{o.settings.noAccount}</p><Link href="/home" className={cn(primary, "mt-8")}>{o.done.open}</Link></Frame>;
  return <Flow initial={guide} />;
}

function Flow({ initial }: { initial: Guide }) {
  const t = useT();
  const o = t.onboarding;
  const router = useRouter();
  const [guide, setGuide] = useState(initial);
  const [step, setStep] = useState<Step>(() => startStep(initial));
  // The agent key exists only in this component's memory: never in the address, storage, the server's answers or a log.
  const [key, setKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const agent = useStore((s) => s.agents.find((a) => a.id === guide.agent?.id));

  // Each step is a new page for a screen reader and the keyboard: focus moves to its heading. Not on first load.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    window.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  const save = async (body: Record<string, unknown>) => {
    const r = await call<Guide>("/api/v1/onboarding", body);
    if (!r.ok) { toast.error(o.saveFailed, { description: errorText(t, r) }); return null; }
    setGuide(r.data);
    return r.data;
  };
  // A step changes only once the server stored it.
  const go = async (next: Step, extra: Record<string, unknown> = {}) => {
    setSaving(true);
    const g = await save({ action: "progress", step: next === "done" ? "notifications" : next, ...extra });
    setSaving(false);
    if (g) setStep(next);
  };
  const skip = async () => { if (await save({ action: "skip" })) router.push("/home"); };

  const props = { headingRef: heading, busy: saving };
  return (
    <Frame step={step} onSkip={step === "done" ? undefined : () => void skip()}>
      <div key={step} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
        {step === "welcome" && <Welcome {...props} onNext={() => void go("connect")} />}
        {step === "connect" && <Connect {...props} guide={guide} save={save} keyValue={key} setKey={setKey} onBack={() => void go("welcome")} onNext={() => void go("verify")} />}
        {step === "verify" && <Verify {...props} agent={agent} name={guide.agent?.name ?? ""} keyValue={key} setKey={setKey} onBack={() => void go("connect")} onNext={() => void go("policy")} />}
        {step === "policy" && guide.agent && <Policy {...props} agentId={guide.agent.id} onBack={() => void go("verify")} onNext={() => void go("test")} />}
        {step === "test" && <LiveTest {...props} agent={agent} onBack={() => void go("policy")} onNext={() => void go("notifications")} />}
        {step === "notifications" && <Notify {...props} onBack={() => void go("test")} onDone={(choice) => void go("done", { notifications: choice })} />}
        {step === "done" && <Done {...props} guide={guide} setGuide={setGuide} onBack={() => void go("test")} onFinish={async () => { setSaving(true); if (await save({ action: "complete" })) router.push("/home"); else setSaving(false); }} />}
      </div>
    </Frame>
  );
}

type StepProps = { headingRef: React.RefObject<HTMLHeadingElement | null>; busy: boolean };

// ---- 1. welcome ------------------------------------------------------------------------------------------

function Welcome({ headingRef, busy, onNext }: StepProps & { onNext: () => void }) {
  const t = useT();
  const w = t.onboarding.welcome;
  const nodes = [{ name: w.flow.agent.name, note: w.flow.agent.note }, { name: "TEND", note: w.flow.tend.note, accent: true }, { name: w.flow.policy.name, note: w.flow.policy.note }, { name: w.flow.tool.name, note: w.flow.tool.note }];
  return (
    <>
      <StepHeader step="welcome" title={w.title} body={w.body} headingRef={headingRef} />
      <ol aria-label={w.flowLabel} className="mt-10 grid gap-2 md:grid-cols-[repeat(4,minmax(0,1fr))] md:gap-0">
        {nodes.map((n, k) => (
          <li key={n.name} className="relative flex items-center gap-3 md:flex-col md:items-start md:gap-0">
            <div className={cn("flex min-w-0 flex-1 items-center gap-3 rounded-xl border px-4 py-3 md:flex-col md:items-start md:gap-1", k < nodes.length - 1 ? "md:w-[calc(100%-20px)]" : "md:w-full", n.accent ? "border-primary/40 bg-primary/[0.05]" : "border-border bg-background")}>
              <span className={cn("text-[14px] font-semibold", n.accent && "tracking-[0.12em] text-primary")}>{n.name}</span>
              <span className="text-[13px] text-muted-foreground">{n.note}</span>
            </div>
            {k < nodes.length - 1 && <ArrowRightIcon aria-hidden className="absolute top-1/2 right-0 hidden size-4 -translate-y-1/2 text-faint md:block" />}
          </li>
        ))}
      </ol>
      <p className="mt-6 flex gap-3 rounded-xl border border-border bg-sunken/60 px-4 py-3.5 text-[14px] text-pretty text-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />{w.scope}
      </p>
      <p className="mt-6 text-[14px] text-muted-foreground">{w.time}</p>
      <Actions><button type="button" disabled={busy} onClick={onNext} className={primary}>{w.start}<ArrowRightIcon className="size-4" aria-hidden /></button></Actions>
    </>
  );
}

// ---- 2. connect ------------------------------------------------------------------------------------------

function Connect({ headingRef, busy, guide, save, keyValue, setKey, onBack, onNext }: StepProps & {
  guide: Guide; save: (b: Record<string, unknown>) => Promise<Guide | null>; keyValue: string | null; setKey: (k: string) => void; onBack: () => void; onNext: () => void;
}) {
  const t = useT();
  const c = t.onboarding.connect;
  const copy = useCopy();
  const registerAgent = useStore((s) => s.registerAgent);
  const rotateKey = useStore((s) => s.rotateKey);
  const origin = useMemo(() => window.location.origin, []);
  const [picked, setPicked] = useState<string | null>(guide.integration);
  const entry = CONNECTABLE.find((i) => i.id === picked);
  const [name, setName] = useState(entry ? c.defaultName(entry.name) : "");
  const [working, setWorking] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // Four to start with (verified first, the common ones first among those); every other implemented way is one click further.
  const shown = CONNECTABLE.slice(0, 4);
  const others = CONNECTABLE.slice(4);

  const choose = (id: string) => {
    const i = CONNECTABLE.find((x) => x.id === id)!;
    setPicked(id);
    setName(c.defaultName(i.name));
    void save({ action: "progress", step: "connect", integration: id });
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entry) return;
    setWorking(true);
    const r = await registerAgent({ name: name.trim(), model: entry.name, provider: (entry.provider ?? "Custom") as Provider, role: t.connect.defaultRole });
    if (!r.ok) { setWorking(false); return setErrors(r.errors?.length ? r.errors : [errorText(t, r)]); }
    setErrors([]);
    setKey(r.apiKey);
    await save({ action: "progress", step: "connect", integration: entry.id, agentId: r.agentId });
    setWorking(false);
  };
  const newKey = async () => {
    if (!guide.agent) return;
    setWorking(true);
    const r = await rotateKey(guide.agent.id);
    setWorking(false);
    if (!r.ok) return toast.error(c.keyFailed, { description: errorText(t, r) });
    setKey(r.apiKey);
  };
  // Buttons, not radios: choosing one moves on, so arrowing through a radio group would choose the first one it touched.
  const card = (i: (typeof CONNECTABLE)[number]) => (
    <button key={i.id} type="button" onClick={() => choose(i.id)}
      className="flex items-start gap-3 rounded-xl border border-border bg-background p-4 text-left outline-none transition-colors hover:border-foreground/25 focus-visible:outline-2 focus-visible:outline-primary">
      <IntegrationLogo entry={i} className="size-9" />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2"><span className="text-[14px] font-semibold">{i.name}</span>
          <span className={cn("rounded-full border px-2 py-px text-[11px]", i.status === "verified" ? "border-primary/25 bg-primary/[0.07] text-primary" : "border-border text-muted-foreground")}>{t.integrations.status[i.status]}</span></span>
        <span className="mt-1 block text-[13px] text-pretty text-muted-foreground">{t.integrations.items[i.id].summary}</span>
      </span>
    </button>
  );

  return (
    <>
      <StepHeader step="connect" title={c.title} body={guide.agent ? undefined : c.body} headingRef={headingRef} />
      {!guide.agent && !entry && (
        <div className="mt-10">
          <div className="grid gap-3 sm:grid-cols-2">{shown.map(card)}</div>
          {others.length > 0 && <Disclosure summary={c.others(others.length)} className="mt-5"><div className="mt-3 grid gap-3 sm:grid-cols-2">{others.map(card)}</div></Disclosure>}
        </div>
      )}
      {!guide.agent && entry && (
        <form onSubmit={create} className="mt-10 grid gap-6">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted-foreground">
            <IntegrationLogo entry={entry} className="size-7" />{c.chosen(entry.name)}
            <button type="button" className="rounded-md font-medium text-primary outline-none hover:underline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => setPicked(null)}>{c.change}</button>
          </p>
          <div className="grid gap-2">
            <label htmlFor="ob-name" className="text-[14px] font-medium">{c.name}</label>
            <input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoComplete="off" aria-describedby="ob-name-hint"
              className="h-11 rounded-lg border border-border bg-background px-3 text-[15px] outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20" />
            <p id="ob-name-hint" className="text-[13px] text-muted-foreground">{c.nameHint}</p>
          </div>
          {errors.length > 0 && <ul role="alert" className="text-[14px] text-[#b42318]">{errors.map((x) => <li key={x}>{x}</li>)}</ul>}
          <div><button type="submit" disabled={working || !name.trim()} className={primary}><KeyRoundIcon className="size-4" aria-hidden />{working ? c.creating : c.create}</button></div>
        </form>
      )}
      {guide.agent && (
        <div className="mt-8 grid gap-8">
          <p className="flex items-center gap-3 text-[15px]"><span aria-hidden className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground"><CheckIcon className="size-3" strokeWidth={3} /></span>{guide.agent.name}</p>
          <section aria-labelledby="ob-key" className="grid gap-3">
            <h2 id="ob-key" className="text-[15px] font-semibold">{c.envTitle}</h2>
            {keyValue ? (
              <>
                <p className="text-[14px] text-muted-foreground">{c.envNote}</p>
                <CodeBlock id="env" label={c.keyTitle} shown={maskedEnv(origin)} text={envCommand(origin, keyValue)} copy={copy} />
                <p className="flex gap-2.5 rounded-lg border border-[#f5d9a8] bg-[#fff8eb] px-3.5 py-2.5 text-[13px] text-pretty text-[#7a3e0a] dark:border-[#5c4318] dark:bg-[#2a2010] dark:text-[#f0c987]">
                  <KeyRoundIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />{c.keyNote}
                </p>
              </>
            ) : (
              <div className="grid justify-items-start gap-3 rounded-xl border border-border px-4 py-4">
                <p className="text-[14px] text-muted-foreground">{c.keyGone}</p>
                <button type="button" disabled={working} onClick={() => void newKey()} className={secondary}><KeyRoundIcon className="size-4" aria-hidden />{c.newKey}</button>
                <p className="text-[13px] text-faint">{c.newKeyNote}</p>
              </div>
            )}
          </section>
          {entry?.connect && (
            <section aria-labelledby="ob-setup" className="grid gap-2">
              <h2 id="ob-setup" className="text-[15px] font-semibold">{c.setupTitle(entry.name)}</h2>
              <p className="text-[14px] text-muted-foreground">{c.setupNote}</p>
              <Disclosure summary={c.setupShow}><div className="mt-3"><CodeBlock id="setup" label={entry.name} shown={agentSnippet(entry.connect, origin)} text={agentSnippet(entry.connect, origin)} copy={copy} /></div></Disclosure>
            </section>
          )}
        </div>
      )}
      <Actions onBack={onBack}>
        {guide.agent && <button type="button" disabled={busy} onClick={onNext} className={primary}>{c.ready}<ArrowRightIcon className="size-4" aria-hidden /></button>}
      </Actions>
    </>
  );
}

// ---- 3. verify ----------------------------------------------------------------------------------------

/** Seconds since the step opened, ticking every second (useNow ticks every 15). */
function useElapsed() {
  const [start] = useState(() => Date.now());
  const [s, setS] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setS(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [start]);
  return s;
}

function Verify({ headingRef, busy, agent, name, keyValue, setKey, onBack, onNext }: StepProps & {
  agent: Agent | undefined; name: string; keyValue: string | null; setKey: (k: string) => void; onBack: () => void; onNext: () => void;
}) {
  const t = useT();
  const v = t.onboarding.verify;
  const copy = useCopy();
  const rotateKey = useStore((s) => s.rotateKey);
  const origin = useMemo(() => window.location.origin, []);
  const elapsed = useElapsed();
  const [freshKey, setFreshKey] = useState(false);
  // lastSeenAt is set only by a request that carried this agent's key, and the store refreshes it from the server every few seconds.
  const seen = agent?.lastSeenAt;
  const stuck = !seen && elapsed >= 30;
  const newKey = async () => {
    if (!agent) return;
    const r = await rotateKey(agent.id);
    if (!r.ok) return toast.error(t.onboarding.connect.keyFailed, { description: errorText(t, r) });
    setKey(r.apiKey);
    setFreshKey(true);
  };
  return (
    <>
      <StepHeader step="verify" title={v.title} body={v.body} headingRef={headingRef} />
      <div className="mt-10 grid gap-3">
        <CodeBlock id="verify" label="Terminal" shown={VERIFY_COMMAND} text={VERIFY_COMMAND} copy={copy} />
        <p className="text-[13px] text-muted-foreground">{v.expect}</p>
      </div>
      <div role="status" aria-live="polite" className={cn("mt-8 flex items-start gap-3 rounded-xl border px-4 py-4 transition-colors duration-300", seen ? "border-primary/30 bg-primary/[0.05]" : "border-border")}>
        {seen ? (
          <><span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><CheckIcon className="size-3" strokeWidth={3} /></span>
            <p className="text-[14px] text-pretty">{v.connected(name, time(t, seen))}</p></>
        ) : (
          <><span aria-hidden className="relative mt-1.5 grid size-2.5 shrink-0 place-items-center"><span className="absolute inline-flex size-full rounded-full bg-primary/40 motion-safe:animate-ping" /><span className="relative size-2 rounded-full bg-primary" /></span>
            <p className="text-[14px] text-muted-foreground tabular-nums">{elapsed < 3 ? v.waiting : v.waitingFor(elapsed)}</p></>
        )}
      </div>
      {stuck && (
        <section aria-labelledby="ob-help" className="mt-6 rounded-xl border border-border px-4 py-4">
          <h2 id="ob-help" className="text-[14px] font-semibold">{v.helpTitle}</h2>
          <ul className="mt-2 grid gap-2 text-[13px] text-pretty text-muted-foreground">{v.help.map((h) => <li key={h} className="flex gap-2.5"><span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />{h}</li>)}</ul>
          <button type="button" onClick={() => void newKey()} className={cn(secondary, "mt-4")}><KeyRoundIcon className="size-4" aria-hidden />{t.onboarding.connect.newKey}</button>
          {freshKey && keyValue && <div className="mt-4"><CodeBlock id="env2" label={t.onboarding.connect.keyTitle} shown={maskedEnv(origin)} text={envCommand(origin, keyValue)} copy={copy} /></div>}
        </section>
      )}
      <Actions onBack={onBack}>
        {stuck && <button type="button" disabled={busy} onClick={onNext} className="rounded-md px-2 text-[14px] text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">{v.skipAhead}</button>}
        <button type="button" disabled={busy || !seen} onClick={onNext} className={primary}>{t.onboarding.continue}<ArrowRightIcon className="size-4" aria-hidden /></button>
      </Actions>
    </>
  );
}

// ---- 4. policy -----------------------------------------------------------------------------------------

/** The plain rule for the test action the server has saved, if the agent is enforcing. */
const savedRule = (v: PolicyView): Effect | null => {
  if (v.enforcement !== "enforce") return null;
  const r = v.rules.find((x) => x.tool === TEST_TOOL && x.action === "ping" && x.resourcePrefix === undefined && x.permission === undefined && x.when === undefined);
  return r && (r.effect === "approve" || r.effect === "allow" || r.effect === "deny") ? r.effect : null;
};

function Policy({ headingRef, busy, agentId, onBack, onNext }: StepProps & { agentId: string; onBack: () => void; onNext: () => void }) {
  const t = useT();
  const p = t.onboarding.policy;
  const getPolicy = useStore((s) => s.getPolicy);
  const savePolicy = useStore((s) => s.savePolicy);
  const [view, setView] = useState<PolicyView | null>(null);
  const [choice, setChoice] = useState<Effect>("approve");
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getPolicy(agentId).then((r) => {
      if (!live) return;
      if (!r.ok) return setFailed(errorText(t, r));
      setView(r.data);
      const saved = savedRule(r.data);
      if (saved) setChoice(saved);
    });
    return () => { live = false; };
  }, [agentId, getPolicy, t]);

  const saved = view ? savedRule(view) : null;
  const save = async () => {
    if (!view) return;
    setWorking(true);
    const r = await savePolicy(agentId, { rules: applyChoices(view.rules, [{ tool: TEST_TOOL, action: "ping", choice: choiceOf(choice) }]), expectedVersion: view.version });
    // Whatever happened, show what the server has now.
    const fresh = await getPolicy(agentId);
    if (fresh.ok) setView(fresh.data);
    setWorking(false);
    if (!r.ok) toast.error(p.failed, { description: errorText(t, r) });
  };

  return (
    <>
      <StepHeader step="policy" title={p.title} body={p.body} headingRef={headingRef} />
      <div className="mt-10">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="text-[15px] font-semibold">{p.action}</span><code className="font-mono text-[12.5px] text-muted-foreground">test_ping · ping</code></p>
        {failed ? <p role="alert" className="mt-4 text-[14px] text-[#b42318]">{p.failed} {failed}</p> : !view ? <p className="mt-4 text-[14px] text-muted-foreground">{p.loading}</p> : (
          <fieldset className="mt-4 grid gap-3">
            <legend className="sr-only">{p.action}</legend>
            {(["approve", "allow", "deny"] as const).map((e) => (
              <label key={e} className="relative flex cursor-pointer gap-3 rounded-xl border border-border bg-background px-4 py-3.5 transition-colors hover:border-foreground/25 has-[:checked]:border-primary has-[:checked]:bg-primary/[0.04] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary">
                <input type="radio" name="effect" value={e} checked={choice === e} onChange={() => setChoice(e)} className="peer sr-only" />
                <span aria-hidden className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-border peer-checked:border-primary peer-checked:[&>span]:scale-100"><span className="size-2 scale-0 rounded-full bg-primary transition-transform duration-150" /></span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2"><span className="text-[14px] font-semibold">{p.options[e].name}</span>
                    {e === "approve" && <span className="rounded-full bg-primary/[0.08] px-2 py-px text-[11px] font-medium text-primary">{p.recommended}</span>}
                    {saved === e && <span className="text-[12px] text-muted-foreground">· {p.current}</span>}</span>
                  <span className="mt-1 block text-[13px] text-pretty text-muted-foreground">{p.options[e].body}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <p role="status" className="mt-4 min-h-5 text-[13px] text-muted-foreground">{saved && saved === choice ? p.saved(p.options[saved].name) : ""}</p>
      </div>
      <Actions onBack={onBack}>
        {saved === choice
          ? <button type="button" disabled={busy} onClick={onNext} className={primary}>{t.onboarding.continue}<ArrowRightIcon className="size-4" aria-hidden /></button>
          : <button type="button" disabled={working || !view} onClick={() => void save()} className={primary}>{working ? p.saving : p.save}</button>}
      </Actions>
    </>
  );
}

// ---- 5. live test ----------------------------------------------------------------------------------------

function LiveTest({ headingRef, busy, agent, onBack, onNext }: StepProps & { agent: Agent | undefined; onBack: () => void; onNext: () => void }) {
  const t = useT();
  const x = t.onboarding.test;
  const copy = useCopy();
  const authorizations = useStore((s) => s.authorizations);
  const taskEvents = useStore((s) => s.taskEvents);
  const decide = useStore((s) => s.decide);
  const skew = useStore((s) => s.skew);
  const now = useNow() + skew;
  const [after, setAfter] = useState(0);
  const [deciding, setDeciding] = useState(false);
  const state = useMemo(() => testState(agent, authorizations, taskEvents, now, after), [agent, authorizations, taskEvents, now, after]);
  const k = state.kind;
  const asked = !["waiting_connection", "connected"].includes(k);
  const decided = ["approved", "running", "verified", "failed", "rejected", "blocked"].includes(k);
  const finished = ["verified", "failed", "rejected", "blocked", "closed"].includes(k);
  const controlled = k === "verified" || k === "rejected" || k === "blocked";
  const answer = async (id: string, status: "approved" | "rejected") => {
    setDeciding(true);
    const r = await decide(id, status);
    setDeciding(false);
    if (!r.ok) toast.error(x.notRecorded, { description: errorText(t, r) });
  };
  const policyName = (reason?: string) => (reason === "approval_required" ? t.onboarding.policy.options.approve.name : reason === "policy_allowed" ? t.onboarding.policy.options.allow.name : null);
  const shown = TEST_COMMAND.split("\n")[0] + "\n  …\nTEND_TEST";

  return (
    <>
      <StepHeader step="test" title={x.title} body={x.body} headingRef={headingRef} />
      {!finished && (
        <div className="mt-10 grid gap-3">
          <CodeBlock id="test" label="Terminal" shown={shown} text={TEST_COMMAND} copy={copy} />
          <p className="text-[13px] text-muted-foreground">{x.requires}</p>
          <Disclosure summary={x.show}><pre className="mt-2 max-h-80 overflow-auto rounded-xl border border-border bg-sunken/60 px-4 py-3 font-mono text-[12px] leading-relaxed">{TEST_SCRIPT}</pre></Disclosure>
        </div>
      )}

      <ul className="mt-8 divide-y divide-border border-y border-border" aria-live="polite">
        <CheckRow state={agent?.lastSeenAt ? "done" : "active"}>{x.checks.connected}</CheckRow>
        <CheckRow state={asked ? "done" : agent?.lastSeenAt ? "active" : "todo"}>{asked ? x.checks.asked : x.waitingRequest}</CheckRow>
        <CheckRow state={decided ? "done" : k === "pending" ? "active" : k === "closed" ? "failed" : "todo"}>{x.checks.decided}</CheckRow>
        <CheckRow state={k === "verified" ? "done" : k === "failed" ? "failed" : k === "approved" || k === "running" ? "active" : "todo"}>
          {k === "approved" ? x.approved : k === "running" ? x.running : x.checks.ran}
        </CheckRow>
      </ul>

      {state.kind === "pending" && (
        <div role="group" aria-labelledby="ob-pending" className="mt-8 rounded-2xl border border-primary/30 bg-background p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] animate-in fade-in-0 zoom-in-[0.99] duration-200 motion-reduce:animate-none md:p-6">
          <h2 id="ob-pending" className="text-[17px] font-semibold">{x.pendingTitle}</h2>
          <p className="mt-1 text-[14px] text-muted-foreground">{x.pendingBody}</p>
          <p className="mt-4 rounded-lg bg-sunken/70 px-3.5 py-2.5 font-mono text-[13px] break-words">{state.auth.tool} · {state.auth.action}{state.auth.detail ? ` · ${state.auth.detail}` : ""}</p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <button type="button" disabled={deciding} onClick={() => void answer(state.auth.id, "approved")} className={primary}>{x.approve}</button>
            <button type="button" disabled={deciding} onClick={() => void answer(state.auth.id, "rejected")} className={secondary}>{x.reject}</button>
          </div>
        </div>
      )}

      {finished && "auth" in state && (
        <section aria-labelledby="ob-outcome" className={cn("mt-8 rounded-2xl border p-5 animate-in fade-in-0 duration-300 motion-reduce:animate-none md:p-6", k === "verified" ? "border-primary/30 bg-primary/[0.04]" : k === "failed" || k === "closed" ? "border-[#f3c9c4] bg-[#fef6f5] dark:border-[#5a2420] dark:bg-[#2a1412]" : "border-border")}>
          <h2 id="ob-outcome" className="text-[17px] font-semibold">{x.outcome[k as keyof typeof x.outcome].title}</h2>
          <p className="mt-1 text-[14px] text-pretty text-muted-foreground">{x.outcome[k as keyof typeof x.outcome].body}</p>
          <h3 className="mt-6 text-[13px] font-medium">{x.audit} <span className="font-normal text-faint">· {x.auditNote}</span></h3>
          <ol className="mt-2 grid gap-2 border-l border-border pl-4 text-[13px]">
            <li><span className="text-faint tabular-nums">{time(t, state.auth.createdAt)}</span> · {x.trail.requested(agent?.name ?? "")} · <code className="font-mono text-[12px] break-words">{state.auth.tool} · {state.auth.action}{state.auth.detail ? ` · ${state.auth.detail}` : ""}</code></li>
            {k === "blocked" ? <li><span className="text-faint tabular-nums">{time(t, state.auth.createdAt)}</span> · {x.trail.blocked}</li>
              : policyName(state.auth.reason) && <li><span className="text-faint tabular-nums">{time(t, state.auth.createdAt)}</span> · {x.trail.policy(policyName(state.auth.reason)!)}</li>}
            {state.auth.decidedAt && (k === "rejected" || state.auth.reason === "approval_required") && <li><span className="text-faint tabular-nums">{time(t, state.auth.decidedAt)}</span> · {k === "rejected" ? x.trail.rejected : x.trail.approved}</li>}
            {"event" in state && <li><span className="text-faint tabular-nums">{time(t, state.event.at)}</span> · {k === "verified" ? x.trail.ran("") : x.trail.failed}</li>}
          </ol>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[14px]">
            <Link href="/timeline" className="font-medium text-primary underline-offset-4 hover:underline">{x.openActivity}</Link>
            <button type="button" onClick={() => setAfter(now)} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{x.again}</button>
          </div>
        </section>
      )}

      <Actions onBack={onBack}>
        <button type="button" disabled={busy || !controlled} onClick={onNext} className={primary}>{t.onboarding.continue}<ArrowRightIcon className="size-4" aria-hidden /></button>
      </Actions>
    </>
  );
}

// ---- 6. notifications -------------------------------------------------------------------------------------

function Notify({ headingRef, busy, onBack, onDone }: StepProps & { onBack: () => void; onDone: (choice: "enabled" | "later") => void }) {
  const t = useT();
  const n = t.onboarding.notifications;
  const { status, busy: pushing, enable } = usePushState();
  return (
    <>
      <StepHeader step="notifications" title={n.title} body={n.body} headingRef={headingRef} />
      <ul className="mt-8 grid gap-3">
        {n.points.map((p) => <li key={p} className="flex gap-3 text-[15px]"><CheckIcon className="mt-1 size-4 shrink-0 text-primary" aria-hidden />{p}</li>)}
      </ul>
      {status !== "off" && status !== "on" && <div className="mt-8"><PushStatusLine status={status} /></div>}
      {status === "on" && <p role="status" className="mt-8 text-[14px] text-primary">{n.enabledNote}</p>}
      <p className="mt-6 text-[13px] text-muted-foreground">{n.inApp}</p>
      <Actions onBack={onBack}>
        <button type="button" disabled={busy || pushing} onClick={() => onDone(status === "on" ? "enabled" : "later")} className={secondary}>{status === "on" ? t.onboarding.continue : n.later}</button>
        {status !== "on" && (
          <button type="button" disabled={busy || pushing || status !== "off"} onClick={async () => { if ((await enable()).ok) onDone("enabled"); }} className={primary}>
            {pushing ? t.notify.prefs.enabling : n.enable}
          </button>
        )}
      </Actions>
    </>
  );
}

// ---- 7. done --------------------------------------------------------------------------------------------

function Done({ headingRef, busy, guide, setGuide, onBack, onFinish }: StepProps & { guide: Guide; setGuide: (g: Guide) => void; onBack: () => void; onFinish: () => void }) {
  const t = useT();
  const d = t.onboarding.done;
  // Asked again here, so the checklist is what the server has now, not what this page remembers.
  useEffect(() => {
    let live = true;
    void call<GuideResponse>("/api/v1/onboarding", undefined, "GET").then((r) => { if (live && r.ok && r.data.available) setGuide(r.data); });
    return () => { live = false; };
  }, [setGuide]);
  const c = guide.checks;
  const opt = t.onboarding.policy.options;
  return (
    <>
      <StepHeader step="done" title={c.test ? d.title : d.missing} body={c.test ? d.body : d.incomplete} headingRef={headingRef} />
      <ul className="mt-10 divide-y divide-border border-y border-border">
        <CheckRow state="done">{d.checks.account}</CheckRow>
        <CheckRow state={c.agent ? "done" : "todo"}>{guide.agent ? d.checks.agent(guide.agent.name) : d.missing}</CheckRow>
        <CheckRow state={c.connectedAt ? "done" : "todo"}>{c.connectedAt ? d.checks.connected(time(t, c.connectedAt)) : t.onboarding.steps.verify}</CheckRow>
        <CheckRow state={c.policy ? "done" : "todo"}>{c.policy ? d.checks.policy(opt[c.policy].name) : t.onboarding.steps.policy}</CheckRow>
        <CheckRow state={c.test ? "done" : "todo"}>{c.test ? d.checks.test[c.test.outcome] : t.onboarding.steps.test}</CheckRow>
        <CheckRow state="done">{d.checks.push[c.notifications ?? "none"]}</CheckRow>
      </ul>
      {c.test && <p className="mt-6 text-[14px] text-pretty text-muted-foreground">{d.next}</p>}
      <Actions onBack={onBack}>
        <button type="button" disabled={busy || !c.test} onClick={onFinish} className={primary}>{busy ? d.opening : d.open}<ArrowRightIcon className="size-4" aria-hidden /></button>
      </Actions>
    </>
  );
}
