"use client";

import Link from "next/link";
import { redirect, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, CopyIcon, KeyRoundIcon } from "lucide-react";
import { SignIn } from "@/components/sign-in";
import { useReadOnlyReason } from "@/components/agent-callout";
import { ProviderIntegrations } from "@/components/provider-integrations";
import { ToolPermissions } from "@/components/tool-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n";
import { TEST_SCRIPT, agentSnippet, connectCommand, maskedCommand } from "@/lib/connect-snippet";
import { IntegrationLogo } from "@/components/integration-logo";
import { INTEGRATIONS, STATUS_ORDER, statusOf } from "@/lib/integrations-catalog";
import { dateTime, timeAgo, useNow } from "@/lib/format";
import { TEST_TOOL, testState } from "@/lib/onboarding";
import type { PolicyView } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import type { Provider } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Disclosure } from "@/ui/disclosure";
import { BackLink, Page, PageSkeleton } from "@/ui/page";

// Everything implemented can be connected, verified first; the status shown is the one the verification report earned.
const CONNECTABLE = INTEGRATIONS.filter((i) => i.connect).map((i) => ({ ...i, status: statusOf(i) })).sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
const PLANNED = INTEGRATIONS.filter((i) => !i.connect);
const SUGGEST = [TEST_TOOL];
type Step = 1 | 2 | 3;

/** A line of the live checklist: hollow until Tend has really seen it, and the words always say which. */
function Check({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-ui">
      <span aria-hidden className={cn("mt-[7px] size-2 shrink-0 rounded-full", done ? "bg-foreground" : "border border-faint")} />
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{children}</span>
    </li>
  );
}

const Block = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("rounded-2xl bg-sunken px-5 py-4", className)}>{children}</div>
);

/** Guided setup: create an assistant, choose what it may do, connect it, and watch one real action pass through the gateway. */
export default function View() {
  const t = useT();
  const ready = useStore((s) => s.ready);
  const status = useStore((s) => s.status);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const readOnly = useReadOnlyReason();
  const provider = useSearchParams().get("provider");
  // Claude Code and Cursor connect through their own hooks, on a page of their own.
  if (provider === "claudeCode" || provider === "cursor") redirect(`/connect/assistant?for=${provider}`);
  if (status === "signin") return <Page><SignIn compact /></Page>;
  if (!ready) return <PageSkeleton label={t.home.loading} />;
  if (!canAct)
    return (
      <Page>
        <BackLink href="/integrations" label={t.integrations.title} />
        <h1 className="mt-8 text-section text-balance">{t.connect.title}</h1>
        <p className="mt-4 max-w-[46ch] text-lead text-muted-foreground">{t.connect.signIn} {readOnly}</p>
      </Page>
    );
  return <Flow />;
}

function Flow() {
  const t = useT();
  const c = t.connect;
  const params = useSearchParams();
  const agents = useStore((s) => s.agents);
  const authorizations = useStore((s) => s.authorizations);
  const taskEvents = useStore((s) => s.taskEvents);
  const skew = useStore((s) => s.skew);
  const registerAgent = useStore((s) => s.registerAgent);
  const rotateKey = useStore((s) => s.rotateKey);
  const decide = useStore((s) => s.decide);
  const now = useNow() + skew;

  const resumed = params.get("agent");
  const [agentId, setAgentId] = useState<string | null>(() => (resumed && agents.some((a) => a.id === resumed && a.origin === "connected") ? resumed : null));
  const [step, setStep] = useState<Step>(agentId ? 2 : 1);
  // The key lives only in this component's memory. It is never put in the address, storage or logs.
  const [key, setKey] = useState<string | null>(null);
  // Step 1 is the choice of how the agent connects; it may come from the Integrations page (?provider=claude).
  const [picked, setPicked] = useState<string | null>(() => (CONNECTABLE.some((i) => i.id === params.get("provider")) ? params.get("provider") : null));
  const entry = CONNECTABLE.find((i) => i.id === picked);
  const [form, setForm] = useState({ name: "", model: "", provider: (entry?.provider ?? "Custom") as Provider });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState<PolicyView | null>(null);
  const [after, setAfter] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const agent = agents.find((a) => a.id === agentId);
  const origin = useMemo(() => window.location.origin, []);
  const state = useMemo(() => testState(agent, authorizations, taskEvents, now, after), [agent, authorizations, taskEvents, now, after]);
  const finished = ["verified", "failed", "rejected", "blocked", "closed"].includes(state.kind);
  const testAllowed = !!policy?.valid && (policy.tools.find((x) => x.tool === TEST_TOOL)?.effect ?? "deny") !== "deny";
  const onView = setPolicy; // a state setter is stable: no wrapper needed

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await registerAgent({ name: form.name.trim(), model: form.model.trim(), provider: form.provider, role: c.defaultRole });
    setBusy(false);
    if (!r.ok) return setErrors(r.errors?.length ? r.errors : [errorText(t, r)]);
    setErrors([]);
    setKey(r.apiKey);
    setAgentId(r.agentId);
    setStep(2);
  };

  const newKey = async () => {
    if (!agentId) return;
    const r = await rotateKey(agentId);
    if (!r.ok) return toast.error(c.s3.keyFailed, { description: errorText(t, r) });
    setKey(r.apiKey);
  };

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied((x) => (x === what ? null : x)), 1500);
    } catch {
      toast.error(c.s3.copyFailed);
    }
  };

  // The only answer given on this screen: the one test request, by itself, with its exact content shown above the buttons.
  const decideTest = async (id: string, status: "approved" | "rejected") => {
    setBusy(true);
    const r = await decide(id, status);
    setBusy(false);
    if (!r.ok) toast.error(c.s3.notRecorded, { description: errorText(t, r) });
  };

  const shownStep = step === 1 ? (entry ? 2 : 1) : step === 2 ? 3 : 4;
  const choose = (id: string) => {
    const i = CONNECTABLE.find((x) => x.id === id);
    setPicked(id);
    setForm((f) => ({ ...f, provider: (i?.provider ?? "Custom") as Provider }));
  };
  const copyButton = (what: string, text: string, label: string) => (
    <Button variant="secondary" className="h-10 rounded-full border-border px-4 text-small" onClick={() => void copy(what, text)}>
      {copied === what ? <CheckIcon /> : <CopyIcon />} {copied === what ? c.s3.copied : label}
    </Button>
  );
  const field = "h-11 rounded-xl text-ui";
  const heading = (text: string) => <h2 className="text-h2 text-balance">{text}</h2>;
  const lead = (text: string) => <p className="mt-3 max-w-[54ch] text-body text-pretty text-muted-foreground">{text}</p>;

  return (
    <Page>
      {shownStep > 1 && <BackLink href="/connect" label={c.title} />}
      <header className={shownStep > 1 ? "mt-8" : undefined}>
        <h1 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em] text-balance">{c.title}</h1>
        <p className="mt-3 max-w-[52ch] text-[15px] text-pretty text-muted-foreground">{shownStep > 1 ? c.description : c.choose}</p>
        {shownStep > 1 && <p className="mt-6 text-small text-muted-foreground" aria-live="polite">{c.stepOf(shownStep, c.steps.length, c.steps[shownStep - 1])}</p>}
      </header>

      {step === 1 && !entry && (
        <div className="mt-10">
          {/* The four ways most people start. Claude Code and Cursor connect through their own hooks on a page of their own. */}
          <div className="grid gap-3 sm:grid-cols-2">
            {(["claudeCode", "cursor"] as const).map((id) => (
              <Link key={id} href={`/connect/assistant?for=${id}`} className="flex items-start gap-3 rounded-xl border border-border bg-background p-4 outline-none transition-colors hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-primary">
                <IntegrationLogo entry={INTEGRATIONS.find((i) => i.id === id)!} className="size-9" />
                <span className="min-w-0"><span className="block text-ui font-semibold">{INTEGRATIONS.find((i) => i.id === id)!.name}</span>
                  <span className="mt-0.5 block text-small text-pretty text-muted-foreground">{t.assistant.options[id].body}</span>
                  <span className={cn("mt-2 inline-block rounded-full border px-2 py-0.5 text-caption", id === "claudeCode" ? "border-primary/25 bg-primary/[0.07] text-primary" : "border-border text-muted-foreground")}>{id === "claudeCode" ? t.assistant.tested : t.assistant.docsOnly}</span></span>
              </Link>
            ))}
            <button type="button" onClick={() => choose("openai")} className="flex items-start gap-3 rounded-xl border border-border bg-background p-4 text-left outline-none transition-colors hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-primary">
              <IntegrationLogo entry={INTEGRATIONS.find((i) => i.id === "openai")!} className="size-9" />
              <span className="min-w-0"><span className="block text-ui font-semibold">{INTEGRATIONS.find((i) => i.id === "openai")!.name}</span><span className="mt-0.5 block text-small text-pretty text-muted-foreground">{t.assistant.options.openai.body}</span></span>
            </button>
            <button type="button" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)} className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-background p-4 text-left outline-none transition-colors hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-primary">
              <span className="min-w-0"><span className="block text-ui font-semibold">{t.assistant.options.other.name}</span><span className="mt-0.5 block text-small text-pretty text-muted-foreground">{t.assistant.options.other.body}</span></span>
            </button>
          </div>
        </div>
      )}

      {step === 1 && !entry && showAll && (
        <div className="mt-12">
          {heading(c.pick.title)}
          {lead(c.pick.body)}
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CONNECTABLE.map((i) => (
              <button key={i.id} type="button" onClick={() => choose(i.id)}
                className="flex items-start gap-3 rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-primary">
                <IntegrationLogo entry={i} className="size-9" />
                <span className="min-w-0">
                  <span className="block text-ui font-semibold">{i.name}</span>
                  <span className="mt-0.5 block text-small text-pretty text-muted-foreground">{t.integrations.items[i.id].summary}</span>
                  <span className={cn("mt-2 inline-block rounded-full border px-2 py-0.5 text-caption", i.status === "verified" ? "border-primary/25 bg-primary/[0.07] text-primary" : "border-border text-muted-foreground")}>{t.integrations.status[i.status]}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="mt-5 text-small text-muted-foreground">{c.pick.planned(PLANNED.length)} <Link href="/integrations" className="text-primary underline-offset-4 hover:underline">{c.pick.all}</Link></p>
        </div>
      )}

      {step === 1 && entry && (
        <div className="mt-12">
          <p className="text-small text-muted-foreground">{c.pick.chosen(entry.name)} <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => setPicked(null)}>{c.pick.change}</button></p>
          <div className="mt-4">{heading(c.s1.title)}</div>
          {lead(c.s1.body)}
          <form onSubmit={create} className="mt-8 grid gap-5">
            <div className="grid gap-2"><Label htmlFor="cn-name">{c.s1.name}</Label><Input id="cn-name" className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} required /></div>
            <div className="grid gap-2"><Label htmlFor="cn-model">{c.s1.model}</Label><Input id="cn-model" className={field} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} maxLength={60} placeholder={c.s1.modelHint} required /></div>
            {errors.length > 0 && <ul role="alert" className="text-small text-clay">{errors.map((x) => <li key={x}>{x}</li>)}</ul>}
            {/* The security facts, stated before anything is created. Shown whatever the display preference is. */}
            <section aria-labelledby="cn-know" className="mt-4">
              <h2 id="cn-know" className="text-title">{c.know.title}</h2>
              <ul className="mt-4 grid gap-3 text-body text-muted-foreground">
                {c.know.items.map((item) => (
                  <li key={item} className="flex gap-3"><span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-faint" /><span className="text-pretty">{item}</span></li>
                ))}
              </ul>
            </section>
            <div><Button type="submit" disabled={busy} className="h-12 rounded-full px-7 text-ui">{busy ? c.s1.creating : c.s1.create}</Button></div>
          </form>
        </div>
      )}

      {step === 2 && agentId && (
        <div className="mt-12">
          {heading(c.s2.title)}
          {lead(c.s2.body)}
          <div className="mt-8"><ToolPermissions agentId={agentId} suggest={SUGGEST} onView={onView} /></div>
          <div className="mt-8 grid justify-items-start gap-3">
            <Button className="h-12 rounded-full px-7 text-ui" disabled={!testAllowed} onClick={() => (setAfter(now), setStep(3))}>{c.s2.next}</Button>
            {!testAllowed && <p className="text-small text-muted-foreground">{c.s2.needTest}</p>}
          </div>
        </div>
      )}

      {step === 3 && agentId && !finished && (
        <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-14">
          <section aria-labelledby="cn-connect">
            <h2 id="cn-connect" className="text-h2 text-balance">{c.s3.title}</h2>
            {lead(c.s3.body)}
            {key ? (
              <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8">
                <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
                  <Label>{c.s3.keyLabel}</Label>
                  <Block className="flex items-center gap-3">
                    <code className="min-w-0 flex-1 overflow-x-auto font-mono text-small whitespace-nowrap select-all">{key}</code>
                    {copyButton("key", key, c.s3.copyKey)}
                  </Block>
                  <p className="text-small text-muted-foreground">{c.s3.keyNote}</p>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
                  <Block><pre className="overflow-x-auto font-mono text-meta leading-relaxed">{maskedCommand(origin).split("\n")[0]}{"\n…\nTEND_TEST"}</pre></Block>
                  <div className="flex flex-wrap gap-2.5">
                    {copyButton("command", connectCommand(origin, key), c.s3.copyCommand)}
                    {copyButton("script", TEST_SCRIPT, c.s3.copyScript)}
                  </div>
                  <p className="text-small text-muted-foreground">{c.s3.runIn}</p>
                  <Disclosure summary={c.s3.showScript} className="-mt-1">
                    <Block className="mt-2"><pre className="overflow-x-auto font-mono text-meta leading-relaxed">{TEST_SCRIPT}</pre></Block>
                  </Disclosure>
                </div>
                {entry?.connect && (
                  <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
                    <h3 className="text-title">{c.use.title(entry.name)}</h3>
                    <p className="text-small text-muted-foreground">{c.use.body}</p>
                    <Disclosure summary={c.use.show}>
                      <Block className="mt-2"><pre className="overflow-x-auto font-mono text-meta leading-relaxed">{agentSnippet(entry.connect, origin)}</pre></Block>
                      <div className="mt-3">{copyButton("snippet", agentSnippet(entry.connect, origin), c.use.copy)}</div>
                    </Disclosure>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-8 grid justify-items-start gap-3">
                <p className="text-body text-muted-foreground">{c.s3.noKey}</p>
                <Button variant="secondary" className="h-11 rounded-full border-border px-5 text-ui" onClick={() => void newKey()}><KeyRoundIcon /> {c.s3.newKey}</Button>
                <p className="text-small text-muted-foreground">{c.s3.newKeyNote}</p>
              </div>
            )}
          </section>

          <section aria-labelledby="cn-seen">
            <h2 id="cn-seen" className="text-h2">{c.s3.checks}</h2>
            <ul className="mt-5 grid gap-3" aria-live="polite">
              <Check done={state.kind !== "waiting_connection"}>
                {state.kind !== "waiting_connection" && agent?.lastSeenAt ? c.s3.connected(timeAgo(agent.lastSeenAt, now)) : c.s3.notConnected}
              </Check>
              <Check done={!["waiting_connection", "connected"].includes(state.kind)}>
                {["waiting_connection", "connected"].includes(state.kind) ? c.s3.notAsked : c.s3.asked}
              </Check>
              {state.kind === "approved" && <Check done={false}>{c.s3.approved}</Check>}
              {state.kind === "running" && <Check done={false}>{c.s3.running}</Check>}
            </ul>
            {state.kind === "pending" && (
              <div role="group" aria-label={c.s3.decisionTitle} className="mt-8 rounded-3xl border border-border bg-surface p-6 shadow-[0_1px_2px_rgb(0_0_0/0.03)] md:p-8">
                <h3 className="text-heading text-balance">{c.s3.decisionTitle}</h3>
                <Block className="mt-5 font-mono text-small break-words">{state.auth.tool} · {state.auth.action}{state.auth.detail ? ` · ${state.auth.detail}` : ""}</Block>
                <div className="mt-6 flex flex-wrap gap-2.5">
                  <Button className="h-11 rounded-full px-6 text-ui" disabled={busy} onClick={() => void decideTest(state.auth.id, "approved")}>{c.s3.approve}</Button>
                  <Button variant="secondary" className="h-11 rounded-full border-border px-6 text-ui" disabled={busy} onClick={() => void decideTest(state.auth.id, "rejected")}>{c.s3.reject}</Button>
                </div>
                <p className="mt-5 text-caption text-faint">{c.s3.decisionBody}</p>
              </div>
            )}
          </section>
        </div>
      )}

      {shownStep === 4 && agentId && finished && (
        <div className="mt-12">
          {heading(state.kind === "verified" ? c.s4.verifiedTitle : state.kind === "failed" ? c.s4.failedTitle : state.kind === "rejected" ? c.s4.rejectedTitle : state.kind === "blocked" ? c.s4.blockedTitle : c.s4.closedTitle)}
          {lead(state.kind === "verified" ? c.s4.verifiedBody : state.kind === "failed" ? c.s4.failedBody : state.kind === "rejected" ? c.s4.rejectedBody : state.kind === "blocked" ? c.s4.blockedBody : c.s4.closedBody)}
          {(state.kind === "verified" || state.kind === "failed") && (
            <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 border-y border-border py-5 text-small">
              <dt className="text-faint">{c.s4.facts.agent}</dt><dd>{agent ? c.s4.agentValue(agent.name, agent.lastSeenAt ? timeAgo(agent.lastSeenAt, now) : "—") : "—"}</dd>
              <dt className="text-faint">{c.s4.facts.action}</dt><dd className="font-mono text-caption break-words">{state.auth.tool} · {state.auth.action}{state.auth.detail ? ` · ${state.auth.detail}` : ""}</dd>
              <dt className="text-faint">{c.s4.facts.decision}</dt><dd>{state.auth.decidedAt ? c.s4.decisionValue(dateTime(state.auth.decidedAt)) : "—"}</dd>
              <dt className="text-faint">{c.s4.facts.ranBy}</dt><dd>{c.s4.ranByValue(dateTime(state.event.at))}</dd>
              <dt className="text-faint">{c.s4.facts.outcome}</dt><dd>{state.kind === "verified" ? c.s4.outcomeValue : state.event.error ?? state.event.outcome}</dd>
              <dt className="text-faint">{c.s4.facts.use}</dt><dd>{c.s4.useValue}</dd>
              <dt className="text-faint">{c.s4.facts.seen}</dt><dd>{c.s4.seenValue}</dd>
              <dt className="text-faint">{c.s4.facts.authorization}</dt><dd className="font-mono text-caption break-all">{state.auth.id}</dd>
            </dl>
          )}
          <p className="mt-6 text-small text-muted-foreground">{state.kind === "verified" ? c.s4.limits : c.s4.repeat}</p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            <Button asChild className="h-12 rounded-full px-7 text-ui"><Link href={`/agents/${agentId}`}>{c.s4.openAgent}</Link></Button>
            <Button variant="secondary" className="h-12 rounded-full border-border px-6 text-ui" onClick={() => setStep(2)}>{c.s4.permissions}</Button>
            {state.kind === "verified" && <Button variant="ghost" className="h-12 rounded-full px-5 text-ui" onClick={() => { setAgentId(null); setKey(null); setPolicy(null); setPicked(null); setForm({ name: "", model: "", provider: "Custom" }); setStep(1); }}>{c.s4.again}</Button>}
          </div>
        </div>
      )}
      <Disclosure summary={c.more} className="mt-16">
        <ProviderIntegrations />
        <Examples />
      </Disclosure>
    </Page>
  );
}

const CURL = `export TEND_URL=http://localhost:3000
export TEND_AGENT_KEY=tend_sk_…        # shown once when the agent is created

# 1. Ask Tend to run an action. These exact parameters are what a person approves.
curl -X POST "$TEND_URL/api/v1/gateway/requests" \\
  -H "Authorization: Bearer $TEND_AGENT_KEY" -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"tool":"write_note","params":{"name":"hello","text":"Hi from my agent"}}'
# 201 {"id":"az_…","status":"pending"}   allowed by policy: "approved"   refused: 403 {"status":"denied","reason":"…"}

# 2. Collect the single-use token once a person approved (202 while nobody has decided; valid 60 s).
curl -X POST "$TEND_URL/api/v1/authorizations/az_…/token" -H "Authorization: Bearer $TEND_AGENT_KEY"

# 3. Run it, once, with exactly the same parameters. Tend runs the tool; your agent never holds the credential.
curl -X POST "$TEND_URL/api/v1/gateway/execute" \\
  -H "Authorization: Bearer $TEND_AGENT_KEY" -H "Content-Type: application/json" \\
  -d '{"authorizationId":"az_…","token":"…","tool":"write_note","params":{"name":"hello","text":"Hi from my agent"}}'`;

function Examples() {
  const t = useT();
  const x = t.connect.examples;
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(CURL); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { toast.error(t.connect.s3.copyFailed); } };
  return (
    <section aria-labelledby="cn-examples" className="mt-16 overflow-hidden rounded-xl border border-border bg-background">
      <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
        <div><h2 id="cn-examples" className="text-[17px] font-semibold">{x.title}</h2><p className="mt-1 max-w-[70ch] text-[14px] text-pretty text-muted-foreground">{x.sub}</p></div>
        <Button variant="secondary" className="h-10 shrink-0 border-border px-4 text-small" onClick={() => void copy()}>{copied ? <CheckIcon /> : <CopyIcon />} {copied ? t.connect.s3.copied : x.copy}</Button>
      </header>
      <pre className="overflow-x-auto border-t border-border bg-[#fafafa] px-6 py-4 font-mono text-[12.5px] leading-relaxed dark:bg-sunken"><code>{CURL}</code></pre>
      <p className="border-t border-border px-6 py-4 text-[13px] text-pretty text-muted-foreground">{x.note}</p>
    </section>
  );
}
