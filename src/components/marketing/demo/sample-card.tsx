"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/i18n/client";
import { fromHook, needsConfirmation, requestKind, showsContent } from "@/lib/home";
import type { Authorization } from "@/lib/types";
import { RequestCardView } from "@/ui/request-card-view";

/** A sample request in the shape the app stores (lib/types.ts), with times as minutes and clock readings so it renders the same everywhere. */
export type SampleRequest = Omit<Authorization, "createdAt" | "expiresAt" | "alerts"> & { askedMinutesAgo: number; lapsesInMinutes: number };

/**
 * One waiting request, exactly as the app's RequestCard (ui/request-card.tsx) builds it, with sample data: the app's sentence, kind,
 * "Asked … · Expires in N min", the exact content, why a person is asked, the details rows, and the second confirmation that spending
 * always needs ("Allow this exact request once?"). Only the network call is missing: answering calls `onAnswered` at once.
 */
export function SampleCard({ request: r, agentName, askedAt, lapsesAt, minutesLeft, onAnswered, className }: {
  request: SampleRequest; agentName: string; askedAt: string; lapsesAt: string; minutesLeft?: number; onAnswered: (answer: "allowed" | "denied") => void; className?: string;
}) {
  const t = useT();
  const h = t.home.request;
  const [step, setStep] = useState<"ask" | "confirm">("ask");
  const kind = requestKind(r.tool);
  const hook = fromHook(r.tool);
  const sentence = h.sentence(r.tool, agentName, r.resource ?? "", r.action);
  const why = r.rule ? (r.rule.effect === "approve" ? t.timelinePage.rule(r.rule) : h.whyAlways) : t.timelinePage.reasons[r.reason ?? ""] ?? r.reason;
  return (
    <RequestCardView
      className={className}
      kind={h.kind[kind]}
      loud={kind === "spend" || kind === "unknown" || kind === "run"}
      sentence={sentence}
      meta={<>{h.asked(t.time.ago(r.askedMinutesAgo, "m"))} · <span className="tabular-nums">{h.lapsesIn(minutesLeft ?? r.lapsesInMinutes)}</span></>}
      exact={(showsContent(kind) || hook) && r.detail ? { label: h.exact, text: r.detail, mono: hook } : undefined}
      item={r.resource && !hook ? { label: h.rows.item, value: r.resource } : undefined}
      why={why ? { label: h.why, value: why } : undefined}
      warning={kind === "unknown" ? h.confirmUnknown : undefined}
      step={step}
      confirm={{ title: h.confirmTitle, body: kind === "spend" ? h.confirmSpend : h.confirmUnknown, yes: h.confirm, back: h.back }}
      labels={{ allow: h.allow, deny: h.deny, details: h.details, saving: h.saving, promise: h.promise }}
      onAllow={() => (needsConfirmation(kind) ? setStep("confirm") : onAnswered("allowed"))}
      onDeny={() => onAnswered("denied")}
      onConfirm={() => onAnswered("allowed")}
      onBack={() => setStep("ask")}
      change={<Link href="/product/rules" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">{h.change}</Link>}
      details={[
        { label: h.rows.assistant, value: agentName },
        { label: h.rows.action, value: `${r.tool} · ${r.action}`, mono: true },
        ...(r.detail && !showsContent(kind) && !hook ? [{ label: h.rows.detail, value: r.detail }] : []),
        { label: h.rows.id, value: r.id, mono: true },
        { label: h.rows.asked, value: askedAt },
        { label: h.rows.lapses, value: lapsesAt },
      ]}
    />
  );
}
