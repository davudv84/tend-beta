"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeftIcon, CheckIcon, CircleAlertIcon, CopyIcon, PlusIcon, XIcon } from "lucide-react";
import { AgentSelect, agentState, Segmented } from "@/components/kit";
import { Gated, useReadOnlyReason } from "@/components/agent-callout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n";
import { ADJUSTMENT_KINDS, ANSWERS, needsReview, parseCheckIn, PROTOCOL, QUESTIONS } from "@/lib/contract";
import { useAgent, useStore } from "@/lib/store";
import type { AdjustmentKind, Answer, QuestionId } from "@/lib/types";
import { cn } from "@/lib/utils";

type Draft = { answer: Answer | ""; confidence: number; explanation: string; explain: boolean };

const blank = () => Object.fromEntries(QUESTIONS.map((q) => [q.id, { answer: "", confidence: 75, explanation: "", explain: false }])) as Record<QuestionId, Draft>;

export default function View() {
  const t = useT();
  const c = t.compose;
  const params = useSearchParams();
  const router = useRouter();
  const agents = useStore((s) => s.agents);
  const compose = useStore((s) => s.composeCheckIn);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const readOnly = useReadOnlyReason();
  const [sending, setSending] = useState(false);
  const [agentId, setAgentId] = useState(() => {
    const p = params.get("agent");
    return agents.some((a) => a.id === p) ? p! : (agents.find((a) => a.origin === "demo" && a.status !== "paused")?.id ?? agents[0]?.id ?? "");
  });
  const agent = useAgent(agentId);
  const [drafts, setDrafts] = useState(blank);
  const [feedback, setFeedback] = useState("");
  const [reflection, setReflection] = useState("");
  const [context, setContext] = useState("");
  const [adjOn, setAdjOn] = useState(false);
  const [adj, setAdj] = useState({ kind: "context" as AdjustmentKind, title: "", detail: "", permission: "" });
  const [errors, setErrors] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const [copied, setCopied] = useState(false);

  const update = (id: QuestionId, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const payload = {
    protocol: PROTOCOL,
    agentId,
    responses: Object.fromEntries(QUESTIONS.map((q) => {
      const d = drafts[q.id];
      return [q.id, { answer: d.answer || null, confidence: d.confidence, ...(d.explain && d.explanation.trim() && { explanation: d.explanation.trim() }) }];
    })),
    feedback: feedback.trim(),
    ...(reflection.trim() && { reflection: reflection.trim() }),
    context: context.trim(),
    ...(adjOn && {
      proposedAdjustment: { kind: adj.kind, title: adj.title.trim(), detail: adj.detail.trim(), ...(adj.kind === "permission" && { permission: adj.permission.trim() }) },
    }),
  };
  const answered = QUESTIONS.filter((q) => drafts[q.id].answer).length;
  const state = agent ? agentState(agent) : null;
  const blocked = !!agent && (agent.status === "paused" || !agent.integrationEnabled);
  const connected = agent?.origin === "connected";
  const curl = `curl -X POST ${typeof location === "undefined" ? "" : location.origin}/api/v1/check-ins \\\n  -H "Authorization: Bearer $TEND_AGENT_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d @check-in.json`;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    const parsed = parseCheckIn(payload);
    if (!parsed.ok) {
      setErrors(parsed.errors.map((x) => {
        const answer = x.match(/^responses\.(\w+)\.answer/);
        if (answer) return c.chooseAnswerFor(t.questions[answer[1] as QuestionId].short);
        if (x.endsWith(".title is required")) return c.titleRequired;
        if (x.includes(".permission is required")) return c.permissionRequired;
        return x;
      }));
      return;
    }
    setSending(true);
    const res = await compose(parsed.value);
    setSending(false);
    if (!res.ok) {
      setErrors(res.errors?.length ? res.errors : [errorText(t, res)]);
      toast.error(c.failed, { description: errorText(t, res) });
      return;
    }
    toast.success(needsReview(parsed.value) ? c.toReview : c.recorded, {
      description: needsReview(parsed.value) ? c.toReviewNote : c.recordedFor(agent?.name ?? ""),
    });
    router.push(`/check-ins/${res.id}`);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t.common.clipboard);
    }
  };

  return (
    <div>
      <Link href="/check-ins" className="mb-8 inline-flex items-center gap-1.5 text-small text-faint transition-colors hover:text-foreground">
        <ArrowLeftIcon className="size-3.5" /> {t.reportPage.back}
      </Link>
      <header className="mb-10 max-w-2xl">
        <p className="eyebrow mb-3">{t.reportsPage.eyebrow}</p>
        <h1 className="text-display leading-tight font-semibold">{c.title}</h1>
        <p className="mt-3 text-ui leading-relaxed text-muted-foreground">
          {c.intro[0]} <span className="font-mono text-small text-foreground">manual</span>{c.intro[1]}
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid content-start gap-6">
          <section className="flex flex-col gap-3 frame py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">{c.reporting}</p>
              <p className="mt-0.5 text-small text-faint">{agent && state ? `${agent.model} · ${agent.provider} · ${t.state.label[state.key]}` : c.choose}</p>
            </div>
            <AgentSelect value={agentId} onChange={(v) => { setAgentId(v); setErrors([]); }} includeAll={false} className="sm:w-52" />
          </section>
          {blocked && (
            <p role="status" className="flex items-start gap-2.5 rounded-lg border border-amber/25 bg-amber/5 px-4 py-3 text-sm text-amber">
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
              {agent!.integrationEnabled ? c.paused(agent!.name) : c.disabled(agent!.name)}
            </p>
          )}

          <ol className="grid gap-px overflow-hidden border-y border-border bg-border">
            {QUESTIONS.map((q, i) => {
              const d = drafts[q.id];
              const missing = tried && !d.answer;
              return (
                <li key={q.id} className="bg-background py-5 pr-5">
                  <div className="flex gap-4">
                    <span className="pt-0.5 font-mono text-xs text-faint">{t.q(i + 1)}</span>
                    <div className="min-w-0 flex-1">
                      <p id={`q-${q.id}`} className="text-ui leading-snug">{t.questions[q.id].text}</p>
                      <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center">
                        <Segmented<Answer | ""> label={t.questions[q.id].text} value={d.answer} onChange={(v) => update(q.id, { answer: v })}
                          className={cn("w-full md:w-auto", missing && "border-destructive/50")}
                          options={ANSWERS.map((a) => ({ value: a, label: t.answers[a] }))} />
                        <div className="flex flex-1 items-center gap-3">
                          <Label htmlFor={`c-${q.id}`} className="shrink-0 text-xs font-normal text-faint">{c.confidence}</Label>
                          <Slider id={`c-${q.id}`} value={[d.confidence]} min={0} max={100} step={5} onValueChange={([v]) => update(q.id, { confidence: v })} aria-label={c.confidenceFor(t.q(i + 1))} className="flex-1" />
                          <span className="w-11 text-right font-mono text-xs whitespace-nowrap tabular-nums text-muted-foreground">{t.pct(d.confidence)}</span>
                        </div>
                      </div>
                      {missing && <p className="mt-2 text-xs text-destructive">{c.chooseAnswer}</p>}
                      {d.explain ? (
                        <Textarea autoFocus value={d.explanation} onChange={(e) => update(q.id, { explanation: e.target.value })} maxLength={2000}
                          placeholder={c.explanation} className="mt-4 min-h-20 bg-background/60 text-sm" aria-label={c.explanationFor(t.q(i + 1))} />
                      ) : (
                        <button type="button" onClick={() => update(q.id, { explain: true })} className="mt-3 inline-flex items-center gap-1 text-xs text-faint transition-colors hover:text-muted-foreground">
                          <PlusIcon className="size-3" /> {c.addExplanation}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <section className="grid gap-5 frame py-5">
            <div className="grid gap-2">
              <Label htmlFor="reflection">{c.note} <span className="font-normal text-faint">· {t.common.optional}</span></Label>
              <Textarea id="reflection" value={reflection} onChange={(e) => setReflection(e.target.value)} maxLength={2000} placeholder={c.notePlaceholder} className="min-h-24 bg-background/60" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="feedback">{c.feedback}</Label>
              <Textarea id="feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={2000} placeholder={c.feedbackPlaceholder} className="min-h-24 bg-background/60" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="context">{c.context}</Label>
              <Input id="context" value={context} onChange={(e) => setContext(e.target.value)} maxLength={2000} placeholder={c.contextPlaceholder} className="bg-background/60" />
            </div>
          </section>

          <section className="frame py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{c.change}</p>
                <p className="mt-1 text-small leading-relaxed text-faint">{c.changeNote}</p>
              </div>
              <Button type="button" variant="outline" onClick={() => setAdjOn((v) => !v)}>{adjOn ? <><XIcon /> {c.remove}</> : <><PlusIcon /> {c.add}</>}</Button>
            </div>
            {adjOn && (
              <div className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-[11rem_1fr]">
                <div className="grid gap-2">
                  <Label>{c.type}</Label>
                  <Select value={adj.kind} onValueChange={(v) => setAdj((a) => ({ ...a, kind: v as AdjustmentKind }))}>
                    <SelectTrigger className="h-9! w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{ADJUSTMENT_KINDS.map((k) => <SelectItem key={k} value={k}>{t.kinds[k]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="adj-title">{c.changeTitle}</Label>
                  <Input id="adj-title" value={adj.title} onChange={(e) => setAdj((a) => ({ ...a, title: e.target.value }))} maxLength={140} placeholder={c.changeTitlePlaceholder} className="h-9 bg-background/60" aria-invalid={tried && !adj.title.trim()} />
                </div>
                {adj.kind === "permission" && (
                  <div className="grid gap-2 sm:col-span-2">
                    <Label htmlFor="adj-perm">{c.permission}</Label>
                    <Input id="adj-perm" value={adj.permission} onChange={(e) => setAdj((a) => ({ ...a, permission: e.target.value }))} placeholder="calendar.write" className="h-9 bg-background/60 font-mono text-small" aria-invalid={tried && !adj.permission.trim()} />
                    <p className="text-xs text-faint">{c.permissionNote}</p>
                  </div>
                )}
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="adj-detail">{c.detail}</Label>
                  <Textarea id="adj-detail" value={adj.detail} onChange={(e) => setAdj((a) => ({ ...a, detail: e.target.value }))} maxLength={2000} placeholder={c.detailPlaceholder} className="min-h-20 bg-background/60" />
                </div>
              </div>
            )}
          </section>

          {errors.length > 0 && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <p className="font-medium">{c.notSent}</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-small">{errors.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Gated allowed={canAct && !connected} reason={!canAct ? readOnly : c.connectedGate}>
              <Button type="submit" size="lg" disabled={!agent || blocked || !canAct || connected || sending}>{sending ? c.sending : c.send}</Button>
            </Gated>
            <span className="font-mono text-xs text-faint">{c.answered(answered, QUESTIONS.length)}</span>
          </div>
        </div>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="frame overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="font-mono text-xs text-muted-foreground">POST /api/v1/check-ins</span>
              <Button type="button" variant="ghost" size="icon-sm" onClick={copy} aria-label={c.copy}>{copied ? <CheckIcon className="text-sage" /> : <CopyIcon />}</Button>
            </div>
            <pre className="max-h-[32rem] overflow-auto p-4 font-mono text-caption leading-relaxed text-muted-foreground">{JSON.stringify(payload, null, 2)}</pre>
          </div>
          {connected ? (
            <div className="mt-4">
              <p className="text-caption text-muted-foreground">{c.sendAs(agent?.name ?? "")}</p>
              <pre className="mt-2 overflow-x-auto border-l border-border pl-3 font-mono text-meta leading-relaxed text-muted-foreground">{curl}</pre>
            </div>
          ) : (
            <p className="mt-3 text-caption text-faint">
              {c.live[0]} <Link href="/developers" className="underline underline-offset-2 hover:text-muted-foreground">{c.live[1]}</Link>{c.live[2]}
            </p>
          )}
        </aside>
      </form>
    </div>
  );
}
