"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { CheckIcon } from "lucide-react";
import { ConnectHelp, HOST_NAME, InstallSteps, PresetPicker, ProtectionTest, isHook, type HookIntegration } from "@/components/assistant-connect";
import { IntegrationLogo } from "@/components/integration-logo";
import { SignIn } from "@/components/sign-in";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n";
import { INTEGRATIONS } from "@/lib/integrations-catalog";
import { useStore } from "@/lib/store";
import type { Provider } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BackLink, Page, PageSkeleton } from "@/ui/page";
import { buttonClass } from "@/ui/primitives";

type StepKey = "choose" | "connect" | "verify" | "active";
const STEPS: StepKey[] = ["choose", "connect", "verify", "active"];

/** One numbered section of the four. Later ones stay closed until the one before is done, so the page reads top to bottom. */
function Section({ n, title, state, children }: { n: number; title: string; state: "done" | "current" | "later"; children?: React.ReactNode }) {
  return (
    <section aria-labelledby={`as-${n}`} className="border-t border-border py-8 first:border-t-0">
      <h2 id={`as-${n}`} className={cn("flex items-center gap-3 text-[17px] font-semibold", state === "later" && "text-faint")}>
        <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center rounded-full border text-[12px] tabular-nums", state === "done" ? "border-primary bg-primary text-primary-foreground" : state === "current" ? "border-primary text-primary" : "border-border")}>
          {state === "done" ? <CheckIcon className="size-3.5" strokeWidth={3} /> : n}
        </span>
        {title}
      </h2>
      {state !== "later" && children && <div className="mt-5 pl-9 animate-in fade-in-0 duration-300 motion-reduce:animate-none">{children}</div>}
    </section>
  );
}

/** Connect AI for Claude Code or Cursor: choose, connect (one command), verify (the installer checks in), protection active. */
export default function View() {
  const t = useT();
  const status = useStore((s) => s.status);
  const ready = useStore((s) => s.ready);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const asked = useSearchParams().get("for");
  if (status === "signin") return <Page><SignIn compact /></Page>;
  if (!ready) return <PageSkeleton label={t.home.loading} />;
  if (!canAct) return <Page><p className="text-lead text-muted-foreground">{t.connect.signIn}</p></Page>;
  return <Flow key={asked ?? ""} initial={isHook(asked) ? asked : null} />;
}

function Flow({ initial }: { initial: HookIntegration | null }) {
  const t = useT();
  const a = t.assistant;
  const registerAgent = useStore((s) => s.registerAgent);
  const rotateKey = useStore((s) => s.rotateKey);
  const [integration, setIntegration] = useState<HookIntegration | null>(initial);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null); // this component's memory only
  const [name, setName] = useState(initial ? `${HOST_NAME[initial]}` : "");
  const [busy, setBusy] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);
  const agent = useStore((s) => s.agents.find((x) => x.id === agentId));
  const seen = !!agent?.lastSeenAt;
  // The first thing TEND recorded from this agent, shown once it is connected, so the person sees a real request and not just a tick.
  const first = useStore((s) => (agentId ? s.authorizations.filter((x) => x.agentId === agentId).sort((x, y) => x.createdAt - y.createdAt)[0] : undefined));
  const current: StepKey = !integration ? "choose" : !agentId ? "connect" : !seen ? "verify" : "active";
  const state = (k: StepKey) => (STEPS.indexOf(k) < STEPS.indexOf(current) ? "done" : k === current ? "current" : "later") as "done" | "current" | "later";
  const entry = integration ? INTEGRATIONS.find((i) => i.id === integration)! : null;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!integration) return;
    setBusy(true);
    // The assistant's name is recorded as the model, which is how TEND later knows this agent connects through hooks.
    const r = await registerAgent({ name: name.trim(), model: HOST_NAME[integration], provider: (integration === "claudeCode" ? "Anthropic" : "Custom") as Provider, role: t.connect.defaultRole });
    setBusy(false);
    if (!r.ok) return toast.error(errorText(t, r));
    setKey(r.apiKey);
    setAgentId(r.agentId);
  };
  const newKey = async () => {
    if (!agentId) return;
    const r = await rotateKey(agentId);
    if (!r.ok) return toast.error(t.onboarding.connect.keyFailed, { description: errorText(t, r) });
    setKey(r.apiKey);
  };

  return (
    <Page>
      <BackLink href="/connect" label={t.connect.title} />
      <h1 className="mt-8 text-[32px] leading-[1.15] font-medium tracking-[-0.02em] text-balance">{integration ? a.connectHost(HOST_NAME[integration]) : t.connect.title}</h1>
      <p className="mt-3 max-w-[54ch] text-[15px] text-pretty text-muted-foreground">{a.connectSub}</p>
      <div className="mt-10">
        <Section n={1} title={a.steps.choose} state={state("choose")}>
          {!integration ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {(["claudeCode", "cursor"] as const).map((id) => (
                <button key={id} type="button" onClick={() => { setIntegration(id); setName(HOST_NAME[id]); }}
                  className="flex items-start gap-3 rounded-xl border border-border bg-background p-4 text-left outline-none transition-colors hover:border-foreground/25 focus-visible:outline-2 focus-visible:outline-primary">
                  <IntegrationLogo entry={INTEGRATIONS.find((i) => i.id === id)!} className="size-9" />
                  <span><span className="block text-[14px] font-semibold">{HOST_NAME[id]}</span><span className="mt-1 block text-[13px] text-muted-foreground">{a.options[id].body}</span></span>
                </button>
              ))}
            </div>
          ) : (
            <p className="flex items-center gap-3 text-[14px] text-muted-foreground">
              {entry && <IntegrationLogo entry={entry} className="size-7" />}{HOST_NAME[integration]} · {integration === "claudeCode" ? a.tested : a.docsOnly}
              {!agentId && <button type="button" onClick={() => setIntegration(null)} className="font-medium text-primary hover:underline">{t.onboarding.connect.change}</button>}
            </p>
          )}
        </Section>
        <Section n={2} title={a.steps.connect} state={state("connect")}>
          {integration && !agentId ? (
            <form onSubmit={create} className="grid max-w-md gap-3">
              <label htmlFor="as-name" className="text-[14px] font-medium">{a.name}</label>
              <input id="as-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoComplete="off" className="h-11 rounded-lg border border-border bg-background px-3 text-[15px] outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20" />
              <div><button type="submit" disabled={busy || !name.trim()} className={buttonClass()}>{busy ? a.creating : a.create}</button></div>
            </form>
          ) : integration && <InstallSteps integration={integration} keyValue={key} onNewKey={() => void newKey()} />}
        </Section>
        <Section n={3} title={a.steps.verify} state={state("verify")}>
          <p role="status" aria-live="polite" className="flex items-center gap-3 text-[14px]">
            {seen && agent?.lastSeenAt
              ? <><CheckIcon className="size-4 text-primary" aria-hidden />{a.verify.done(new Date(agent.lastSeenAt).toLocaleTimeString(t.intl.time))} {integration && a.verify.next(HOST_NAME[integration])}</>
              : <><span aria-hidden className="relative grid size-2.5 place-items-center"><span className="absolute inline-flex size-full rounded-full bg-primary/40 motion-safe:animate-ping" /><span className="relative size-2 rounded-full bg-primary" /></span>{a.verify.waiting}</>}
          </p>
          {seen && <p className="mt-3 text-[14px] text-muted-foreground">{first ? <>{a.verify.first} <code className="font-mono text-[13px] text-foreground">{first.detail ?? `${first.tool} · ${first.action}`}</code></> : a.verify.noneYet}</p>}
          {!seen && integration && <div className="mt-4"><ConnectHelp integration={integration} /></div>}
        </Section>
        <Section n={4} title={a.steps.active} state={state("active")}>
          {agent && integration && (
            <div className="grid gap-10">
              <PresetPicker agentId={agent.id} onSaved={setPreset} />
              {preset && <div><h3 className="mb-3 text-[15px] font-semibold">{a.protection.title}</h3><ProtectionTest agent={agent} hostName={HOST_NAME[integration]} /></div>}
              <Link href={`/agents/${agent.id}`} className="text-[14px] font-medium text-primary hover:underline">{t.connect.s4.openAgent} →</Link>
            </div>
          )}
        </Section>
      </div>
    </Page>
  );
}
