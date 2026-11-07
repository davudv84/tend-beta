"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n";
import { clock, timeAgo } from "@/lib/format";
import { fromHook, needsConfirmation, showsContent, type HomeRequest } from "@/lib/home";
import { useStore } from "@/lib/store";
import { useUiPrefs } from "@/ui/prefs-context";
import { RequestCardView } from "@/ui/request-card-view";

export type Answer = "allowed" | "denied";

/**
 * One request that needs a person, and nothing else on it competing for attention. It always shows who is asking, what for,
 * and the exact content to be decided (what would be written, what would be paid); it never answers more than this one request.
 * Spending needs a second explicit confirmation. An action Tend does not recognise is decided once, with a warning shown above the buttons.
 * The markup is RequestCardView, shared with the homepage's demo.
 */
export function RequestCard({ request, now, onAnswered }: { request: HomeRequest; now: number; onAnswered: (id: string, answer: Answer, sentence: string) => void }) {
  const t = useT();
  const h = t.home.request;
  const decide = useStore((s) => s.decide);
  const [prefs] = useUiPrefs();
  const [step, setStep] = useState<"ask" | "confirm" | "saving">("ask");
  const [error, setError] = useState<string | null>(null);
  const { auth, agent, kind, lapsesAt } = request;
  const sentence = h.sentence(auth.tool, agent.name, auth.resource ?? "", auth.action);
  const minutes = Math.max(1, Math.ceil((lapsesAt - now) / 60_000));
  // Why a person is asked, from what was recorded when the agent asked: the rule that decided it, or the recorded reason code.
  const why = auth.rule ? (auth.rule.effect === "approve" ? t.timelinePage.rule(auth.rule) : h.whyAlways) : t.timelinePage.reasons[auth.reason ?? ""] ?? auth.reason;
  // A coding assistant's request is its exact command, path or address: always shown, in a typewriter face so it reads as written.
  const hook = fromHook(auth.tool);

  const answer = async (status: "approved" | "rejected") => {
    setStep("saving");
    setError(null);
    const r = await decide(auth.id, status);
    if (!r.ok) {
      setError(`${h.failed} ${errorText(t, r)}`.trim());
      setStep("ask");
      return;
    }
    onAnswered(auth.id, status === "approved" ? "allowed" : "denied", sentence);
  };

  const loud = kind === "spend" || kind === "unknown" || kind === "run";
  return (
    <RequestCardView
      kind={h.kind[kind]}
      loud={loud}
      sentence={sentence}
      meta={<>{h.asked(timeAgo(auth.createdAt, now))} · {h.lapsesIn(minutes)}</>}
      exact={(showsContent(kind) || hook) && auth.detail ? { label: h.exact, text: auth.detail, mono: hook } : undefined}
      item={auth.resource && !hook ? { label: h.rows.item, value: auth.resource } : undefined}
      why={why ? { label: h.why, value: why } : undefined}
      warning={kind === "unknown" ? h.confirmUnknown : undefined}
      step={step}
      confirm={{ title: h.confirmTitle, body: kind === "spend" ? h.confirmSpend : h.confirmUnknown, yes: h.confirm, back: h.back }}
      labels={{ allow: h.allow, deny: h.deny, details: h.details, saving: h.saving, promise: h.promise }}
      onAllow={() => (needsConfirmation(kind) ? setStep("confirm") : void answer("approved"))}
      onDeny={() => void answer("rejected")}
      onConfirm={() => void answer("approved")}
      onBack={() => setStep("ask")}
      error={error}
      change={<Link href={`/agents/${agent.id}?tab=rules`} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">{h.change}</Link>}
      details={[
        { label: h.rows.assistant, value: agent.name },
        { label: h.rows.action, value: `${auth.tool} · ${auth.action}`, mono: true },
        ...(auth.detail && !showsContent(kind) && !hook ? [{ label: h.rows.detail, value: auth.detail }] : []),
        { label: h.rows.id, value: auth.id, mono: true },
        { label: h.rows.asked, value: clock(auth.createdAt) },
        { label: h.rows.lapses, value: clock(lapsesAt) },
      ]}
      detailsOpen={prefs.details}
      detailsFooter={<Link href="/oversight" className="mt-3 inline-block text-small text-primary underline-offset-4 hover:underline">{h.technical}</Link>}
    />
  );
}
