"use client";

// Connecting a coding assistant (Claude Code, Cursor) through its hooks, shared by the setup guide, Connect AI and the agent's page: the one
// install command, the strictness presets, and "Test my protection" from the assistant's real calls. Nothing here claims a protection works
// until this agent's own records show it (src/lib/protection.ts).
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, CopyIcon, KeyRoundIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n/error-text";
import { coverageOf, PRESETS, type Covered, presetOf, presetRules, TEST_COMMANDS, type PresetId } from "@/lib/agent-presets";
import { useNow } from "@/lib/format";
import type { PolicyView, RuleLike } from "@/lib/permissions";
import { evidenceOf, pendingTest, type Check } from "@/lib/protection";
import { useStore } from "@/lib/store";
import type { Agent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Disclosure } from "@/ui/disclosure";
import { buttonClass } from "@/ui/primitives";

/** Integrations connected through hooks, and the name tend-hooks.mjs knows them by. */
export const HOOK_HOSTS = { claudeCode: "claude-code", cursor: "cursor" } as const;
export type HookIntegration = keyof typeof HOOK_HOSTS;
export const isHook = (id: string | null | undefined): id is HookIntegration => !!id && Object.hasOwn(HOOK_HOSTS, id);
/** Which hook integration an agent was connected with: the setup records the assistant's name as the agent's model. */
export const hookOf = (agent: Pick<Agent, "model">): HookIntegration | null => (agent.model === "Claude Code" ? "claudeCode" : agent.model === "Cursor" ? "cursor" : null);
export const HOST_NAME: Record<HookIntegration, string> = { claudeCode: "Claude Code", cursor: "Cursor" };
const SETTINGS_FILE: Record<HookIntegration, string> = { claudeCode: "~/.claude/settings.json", cursor: "~/.cursor/hooks.json" };

function useCopy() {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (id: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600); }
    catch { toast.error(t.onboarding.copyFailed); }
  };
  return { copied, copy };
}

/** What is shown can differ from what is copied: the key is copied, never displayed. */
export function Copyable({ id, label, shown, text, copy }: { id: string; label: string; shown: string; text: string; copy: ReturnType<typeof useCopy> }) {
  const t = useT();
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-sunken/60">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <span className="truncate text-[12px] font-medium text-muted-foreground">{label}</span>
        <button type="button" onClick={() => void copy.copy(id, text)}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium outline-none transition-colors hover:bg-black/[0.05] focus-visible:outline-2 focus-visible:outline-primary dark:hover:bg-white/[0.08]">
          {copy.copied === id ? <CheckIcon className="size-3.5 text-primary" aria-hidden /> : <CopyIcon className="size-3.5" aria-hidden />}
          <span aria-live="polite">{copy.copied === id ? t.onboarding.copied : t.onboarding.copy}</span>
        </button>
      </div>
      <pre className="px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-all"><code>{shown}</code></pre>
    </div>
  );
}

/** The one command, and the key it asks for. Running it is the person's choice: the installer shows what it changes and asks first. */
export function InstallSteps({ integration, keyValue, onNewKey, busy }: { integration: HookIntegration; keyValue: string | null; onNewKey: () => void; busy?: boolean }) {
  const t = useT();
  const x = t.assistant.install;
  const copy = useCopy();
  const origin = useMemo(() => window.location.origin, []);
  const host = HOOK_HOSTS[integration];
  const command = `mkdir -p ~/.tend && curl -fsSL ${origin}/sdk/tend-hooks.mjs -o ~/.tend/tend-hooks.mjs && node ~/.tend/tend-hooks.mjs install ${host} --url ${origin}`;
  return (
    <div className="grid gap-5">
      <p className="max-w-[60ch] text-[15px] text-pretty text-muted-foreground">{x.body(HOST_NAME[integration])}</p>
      <Copyable id="install" label={x.command} shown={command} text={command} copy={copy} />
      {keyValue ? (
        <div className="grid gap-2">
          <Copyable id="key" label={x.key} shown="tend_sk_••••••••••••••••" text={keyValue} copy={copy} />
          <p className="text-[13px] text-muted-foreground">{x.keyNote}</p>
        </div>
      ) : (
        <div className="grid justify-items-start gap-3 rounded-xl border border-border px-4 py-4">
          <p className="text-[14px] text-muted-foreground">{x.keyGone}</p>
          <button type="button" disabled={busy} onClick={onNewKey} className={buttonClass("secondary")}><KeyRoundIcon className="size-4" aria-hidden />{x.newKey}</button>
        </div>
      )}
      <p className="text-[13px] text-muted-foreground">{x.needs}</p>
      <section aria-labelledby="ac-changes" className="rounded-xl border border-border px-4 py-3.5">
        <h3 id="ac-changes" className="text-[14px] font-semibold">{x.changesTitle}</h3>
        <ul className="mt-2 grid gap-1.5 text-[13px] text-pretty text-muted-foreground">
          {x.changes(SETTINGS_FILE[integration], host).map((c) => <li key={c} className="flex gap-2.5"><span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />{c}</li>)}
        </ul>
      </section>
      <Disclosure summary={x.advanced}><p className="mt-2 font-mono text-[12.5px] text-pretty break-words text-muted-foreground">{x.project(host)}</p></Disclosure>
    </div>
  );
}


/** What to do when the connection or the test does not work: the messages the installer and the hook actually print, and the fix for each. */
export function ConnectHelp({ integration, open }: { integration: HookIntegration; open?: boolean }) {
  const t = useT();
  const h = t.assistant.help;
  return (
    <Disclosure summary={h.title} open={open}>
      <ul className="mt-2 grid gap-2 text-[13px] text-pretty text-muted-foreground">
        {h.items(HOST_NAME[integration], HOOK_HOSTS[integration]).map((x) => <li key={x} className="flex gap-2.5"><span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" /><span className="break-words">{x}</span></li>)}
      </ul>
    </Disclosure>
  );
}

const savedPreset = (v: PolicyView | null) => (v && v.enforcement === "enforce" ? presetOf(v.rules) : null);

/** Balanced, Strict or Monitor only, saved as the agent's policy and read back from the server. */
export function PresetPicker({ agentId, onSaved, titled = true, coverage }: { agentId: string; onSaved?: (p: PresetId | null) => void; titled?: boolean; coverage?: HookIntegration }) {
  const t = useT();
  const p = t.assistant.presets;
  const getPolicy = useStore((s) => s.getPolicy);
  const savePolicy = useStore((s) => s.savePolicy);
  const [view, setView] = useState<PolicyView | null>(null);
  const [choice, setChoice] = useState<PresetId>("balanced");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void getPolicy(agentId).then((r) => {
      if (!live || !r.ok) return;
      setView(r.data);
      const s = savedPreset(r.data);
      if (s) setChoice(s);
      onSaved?.(s);
    });
    return () => { live = false; };
  }, [agentId, getPolicy, onSaved]);
  const saved = savedPreset(view);
  const custom = view && !saved ? view.rules.length : 0;
  const save = async () => {
    if (!view) return;
    setBusy(true);
    const r = await savePolicy(agentId, { rules: presetRules(choice), expectedVersion: view.version });
    const fresh = await getPolicy(agentId);
    setBusy(false);
    if (fresh.ok) { setView(fresh.data); onSaved?.(savedPreset(fresh.data)); }
    if (!r.ok) toast.error(p.failed, { description: errorText(t, r) });
  };
  return (
    <div className="grid gap-3">
      <fieldset className="grid gap-3">
        <legend className={titled ? "mb-1 text-[15px] font-semibold" : "sr-only"}>{p.title}</legend>
        {PRESETS.map((id) => (
          <label key={id} className="relative flex cursor-pointer gap-3 rounded-xl border border-border bg-background px-4 py-3.5 transition-colors hover:border-foreground/25 has-[:checked]:border-primary has-[:checked]:bg-primary/[0.04] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary">
            <input type="radio" name={`preset-${agentId}`} value={id} checked={choice === id} onChange={() => setChoice(id)} className="peer sr-only" />
            <span aria-hidden className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-border peer-checked:border-primary peer-checked:[&>span]:scale-100"><span className="size-2 scale-0 rounded-full bg-primary transition-transform duration-150" /></span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2"><span className="text-[14px] font-semibold">{p[id].name}</span>
                {id === "balanced" && <span className="rounded-full bg-primary/[0.08] px-2 py-px text-[11px] font-medium text-primary">{p.recommended}</span>}
                {saved === id && <span className="text-[12px] text-muted-foreground">· {p.current}</span>}</span>
              <span className="mt-1 block text-[13px] text-pretty text-muted-foreground">{p[id].body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {custom > 0 && <p className="text-[13px] text-[#92400e] dark:text-[#f0c987]">{p.replaces(custom)}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || !view || saved === choice} onClick={() => void save()} className={buttonClass()}>{busy ? p.saving : p.save}</button>
        <p role="status" className="text-[13px] text-muted-foreground">{saved && saved === choice ? p.saved(p[saved].name) : ""}</p>
      </div>
      {coverage && view && <Coverage view={view} integration={coverage} />}
    </div>
  );
}

const SHOWN = 6;

/**
 * What the saved rules enforce, what they only record, and what TEND cannot reach at all, so nobody reads more protection into it than
 * there is. Read from the saved rules (the same ones the server decides with); the last group is the same for every policy.
 */
export function Coverage({ view, integration }: { view: PolicyView; integration: HookIntegration }) {
  const t = useT();
  const c = t.assistant.coverage;
  const central = view.central;
  // An unreadable policy, the agent's own or the central one, makes the server deny every call (fail closed): say exactly that.
  const unreadable = !view.valid || (central && !central.valid);
  const { enforced, monitored, unruled } = coverageOf(unreadable ? [] : view.rules, unreadable ? [] : central?.rules);
  const kinds = unruled.map((k) => c.kinds[k]).join(", ");
  const say = (r: Covered, text: string) => (r.from === "central" ? `${text} · ${c.fromCentral}` : text);
  return (
    <section aria-labelledby={`coverage-${integration}`} className="mt-5 grid gap-3">
      <div>
        <h3 id={`coverage-${integration}`} className="text-[15px] font-semibold">{c.title}</h3>
        <p className="mt-1 text-[13px] text-pretty text-muted-foreground">{c.intro(HOST_NAME[integration])}</p>
        {central && <p className="mt-1 text-[13px] text-pretty text-muted-foreground">{c.central}</p>}
      </div>
      <CoverageGroup title={c.enforced} sub={c.enforcedSub} empty={c.enforcedNone}
        items={unreadable ? [c.blocksAll] : [...enforced.map((r) => say(r, t.timelinePage.rule(r))), ...(kinds ? [c.unruled(kinds)] : [])]} />
      <CoverageGroup title={c.monitored} sub={c.monitoredSub} empty={c.monitoredNone} items={monitored.map((r) =>
        // A catch-all "allow" next to stricter rules for the same kind lets through only what those rules don't catch.
        say(r, r.action === "*" && !r.when && enforced.some((e) => e.tool === r.tool) ? c.rest(c.kinds[r.tool]) : t.timelinePage.rule(r)))} />
      <CoverageGroup title={c.outside} sub={c.outsideSub} items={[...c.outsideItems, ...(integration === "cursor" ? [c.cursor] : [])]} />
      <p className="text-[13px] text-pretty text-muted-foreground">{c.footer}</p>
    </section>
  );
}

function CoverageGroup({ title, sub, items, empty }: { title: string; sub: string; items: string[]; empty?: string }) {
  const t = useT();
  const li = (x: string, i: number) => <li key={i} className="flex gap-2.5"><span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" /><span className="min-w-0 break-words">{x}</span></li>;
  return (
    <div className="rounded-xl border border-border px-4 py-3.5">
      <h4 className="text-[14px] font-semibold">{title}</h4>
      <p className="mt-0.5 text-[13px] text-pretty text-muted-foreground">{sub}</p>
      {items.length ? (
        <>
          <ul className="mt-2.5 grid gap-1.5 text-[13px]">{items.slice(0, SHOWN).map(li)}</ul>
          {items.length > SHOWN && (
            <Disclosure summary={t.home.more(items.length - SHOWN)} className="mt-1.5">
              <ul className="grid gap-1.5 pt-1 text-[13px]">{items.slice(SHOWN).map((x, i) => li(x, i + SHOWN))}</ul>
            </Disclosure>
          )}
        </>
      ) : <p className="mt-2.5 text-[13px]">{empty}</p>}
    </div>
  );
}

const hasTestRules = (rules: RuleLike[]) => [TEST_COMMANDS.blocked, TEST_COMMANDS.approval].every((cmd) =>
  rules.some((r) => r.tool === "shell" && (r.when as { command?: { startsWith?: string } } | undefined)?.command?.startsWith === cmd));

/** The two test rules every preset has, added to whatever rules the agent already has. Both only make a command stricter. */
const withTestRules = (rules: RuleLike[]) => [...presetRules("monitor").slice(0, 2), ...rules.filter((r) => !hasTestRules([r]))];

function Result({ label, state, word }: { label: string; state: Check; word: string }) {
  const t = useT();
  return (
    <li className="flex items-center justify-between gap-4 py-2.5 text-[14px]">
      <span>{label}</span>
      <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium", state === "working" ? "text-primary" : "text-muted-foreground")}>
        <span aria-hidden className={cn("size-1.5", state === "working" ? "rounded-full bg-primary" : "rounded-full border border-current")} />
        {state === "working" ? word : t.assistant.protection.notVerified}
      </span>
    </li>
  );
}

/**
 * "Test my protection": the person asks their real assistant to run three harmless commands, and the results appear as this agent's own
 * records arrive. The approval test is answered here, through the normal review route.
 */
export function ProtectionTest({ agent, hostName, onEvidence }: { agent: Agent; hostName: string; onEvidence?: (controlled: boolean) => void }) {
  const t = useT();
  const x = t.assistant.protection;
  const copy = useCopy();
  const auths = useStore((s) => s.authorizations);
  const events = useStore((s) => s.taskEvents);
  const decide = useStore((s) => s.decide);
  const getPolicy = useStore((s) => s.getPolicy);
  const savePolicy = useStore((s) => s.savePolicy);
  const skew = useStore((s) => s.skew);
  const now = useNow() + skew;
  const [since, setSince] = useState<number | null>(null);
  const [rules, setRules] = useState<PolicyView | null>(null);
  const [busy, setBusy] = useState(false);
  const ev = useMemo(() => evidenceOf(agent, auths, events, since ?? 0), [agent, auths, events, since]);
  const waiting = pendingTest(agent.id, auths, now);
  const controlled = ev.blocking === "working" || ev.approval === "working";
  useEffect(() => { onEvidence?.(controlled); }, [controlled, onEvidence]);
  useEffect(() => {
    let live = true;
    void getPolicy(agent.id).then((r) => { if (live && r.ok) setRules(r.data); });
    return () => { live = false; };
  }, [agent.id, getPolicy, agent.configVersion]);
  const missing = rules && (!hasTestRules(rules.rules) || rules.enforcement !== "enforce");
  const addRules = async () => {
    if (!rules) return;
    setBusy(true);
    const r = await savePolicy(agent.id, { rules: withTestRules(rules.rules), expectedVersion: rules.version });
    const fresh = await getPolicy(agent.id);
    setBusy(false);
    if (fresh.ok) setRules(fresh.data);
    if (!r.ok) toast.error(t.assistant.presets.failed, { description: errorText(t, r) });
  };
  const answer = async (id: string, status: "approved" | "rejected") => {
    setBusy(true);
    const r = await decide(id, status);
    setBusy(false);
    if (!r.ok) toast.error(x.notRecorded, { description: errorText(t, r) });
  };

  return (
    <div className="grid gap-5">
      <p className="max-w-[60ch] text-[14px] text-pretty text-muted-foreground">{x.sub(hostName)}</p>
      <ul aria-live="polite" className="divide-y divide-border border-y border-border">
        <Result label={x.rows.connection} state={ev.connection} word={x.verified} />
        <Result label={x.rows.monitoring} state={ev.monitoring} word={x.working} />
        <Result label={x.rows.blocking} state={ev.blocking} word={x.working} />
        <Result label={x.rows.approval} state={ev.approval} word={x.working} />
      </ul>
      <p className="-mt-2 text-[12px] text-faint">{since === null ? x.lastResults : x.testing}</p>
      {missing && (
        <div className="grid justify-items-start gap-2 rounded-xl border border-border px-4 py-3.5">
          <p className="text-[13px] text-pretty text-muted-foreground">{x.missingRules}</p>
          <button type="button" disabled={busy} onClick={() => void addRules()} className={buttonClass("secondary")}>{x.addRules}</button>
        </div>
      )}
      {since === null ? (
        <div><button type="button" onClick={() => setSince(now - 1000)} className={buttonClass()}>{controlled ? x.again : x.start}</button></div>
      ) : (
        <div className="grid gap-3">
          <p className="text-[14px] font-medium">{x.ask(hostName)}</p>
          {(["activity", "blocked", "approval"] as const).map((k) => <Copyable key={k} id={k} label={k === "approval" ? x.approvalHint : x.promptLabel} shown={x.prompts[k]} text={x.prompts[k]} copy={copy} />)}
        </div>
      )}
      {waiting && (
        <div role="group" aria-labelledby="pt-wait" className="rounded-2xl border border-primary/30 p-4 animate-in fade-in-0 duration-200 motion-reduce:animate-none">
          <p id="pt-wait" className="text-[14px] font-semibold">{x.waiting(hostName)}</p>
          <p className="mt-2 rounded-lg bg-sunken/70 px-3 py-2 font-mono text-[13px] break-words">{waiting.detail}</p>
          <div className="mt-3 flex gap-2.5">
            <button type="button" disabled={busy} onClick={() => void answer(waiting.id, "approved")} className={buttonClass()}>{x.approve}</button>
            <button type="button" disabled={busy} onClick={() => void answer(waiting.id, "rejected")} className={buttonClass("secondary")}>{x.reject}</button>
          </div>
        </div>
      )}
      {hookOf({ model: hostName }) && <ConnectHelp integration={hookOf({ model: hostName })!} />}
      <p className="text-[12px] text-pretty text-muted-foreground">{x.real} {x.limits(hostName)}</p>
    </div>
  );
}
