"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n";
import { clock, timeAgo } from "@/lib/format";
import { needsConfirmation, showsContent, type HomeRequest } from "@/lib/home";
import { useStore } from "@/lib/store";
import { Disclosure } from "@/ui/disclosure";
import { useUiPrefs } from "@/ui/prefs-context";

export type Answer = "allowed" | "denied";

/**
 * One request that needs a person, and nothing else on it competing for attention. It always shows who is asking, what for,
 * and the exact content to be decided (what would be written, what would be paid); it never answers more than this one request.
 * Spending, and anything Tend does not recognise, needs a second explicit confirmation.
 */
export function RequestCard({ request, now, onAnswered }: { request: HomeRequest; now: number; onAnswered: (id: string, answer: Answer, sentence: string) => void }) {
  const t = useT();
  const h = t.home.request;
  const decide = useStore((s) => s.decide);
  const [prefs] = useUiPrefs();
  const headingId = useId();
  const [step, setStep] = useState<"ask" | "confirm" | "saving">("ask");
  const [error, setError] = useState<string | null>(null);
  const { auth, agent, kind, lapsesAt } = request;
  const sentence = h.sentence(auth.tool, agent.name, auth.resource ?? "", auth.action);
  const minutes = Math.max(1, Math.ceil((lapsesAt - now) / 60_000));

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

  const busy = step === "saving";
  const button = "h-11 rounded-full px-6 text-ui";
  const loud = kind === "spend" || kind === "unknown";
  return (
    <article aria-labelledby={headingId} aria-busy={busy} className="rounded-3xl border border-border bg-surface p-6 shadow-[0_1px_2px_rgb(0_0_0/0.03)] md:p-8">
      {/* What kind of action it is comes first, as a word, so the risky ones are known before anything else is read. */}
      <p className={loud ? "text-small font-medium text-foreground" : "text-small text-muted-foreground"}>{h.kind[kind]}</p>
      <h3 id={headingId} className="mt-2 text-heading text-balance">{sentence}</h3>
      <p className="mt-2 text-small text-muted-foreground">{h.asked(timeAgo(auth.createdAt, now))} · {h.lapsesIn(minutes)}</p>

      {/* The exact content. Never inside "Details": it is what the person is deciding. */}
      {showsContent(kind) && auth.detail && (
        <blockquote className="mt-6 rounded-2xl bg-sunken px-5 py-4 text-body break-words whitespace-pre-wrap">{auth.detail}</blockquote>
      )}

      {step === "confirm" ? (
        <div role="group" aria-label={h.confirmTitle} className="mt-6 rounded-2xl border border-border p-5">
          <p className="text-ui font-medium">{h.confirmTitle}</p>
          <p className="mt-1 text-small text-muted-foreground">{kind === "spend" ? h.confirmSpend : h.confirmUnknown}</p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Button className={button} disabled={busy} onClick={() => void answer("approved")}>{h.confirm}</Button>
            <Button variant="ghost" className={button} disabled={busy} onClick={() => setStep("ask")}>{h.back}</Button>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap gap-2.5">
          <Button className={button} disabled={busy} onClick={() => (needsConfirmation(kind) ? setStep("confirm") : void answer("approved"))}>{h.allow}</Button>
          <Button variant="secondary" className={`${button} border-border`} disabled={busy} onClick={() => void answer("rejected")}>{h.deny}</Button>
        </div>
      )}
      <p role="status" className={busy ? "mt-3 text-small text-muted-foreground" : "sr-only"}>{busy ? h.saving : ""}</p>
      {error && <p role="alert" className="mt-3 text-small text-clay">{error}</p>}

      <p className="mt-5 text-caption text-faint">{h.promise}</p>

      <Disclosure summary={h.details} open={prefs.details} className="mt-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-border pt-3 text-small">
          <dt className="text-faint">{h.rows.assistant}</dt><dd>{agent.name}</dd>
          <dt className="text-faint">{h.rows.action}</dt><dd className="font-mono text-caption break-all">{auth.tool} · {auth.action}</dd>
          {auth.resource && <><dt className="text-faint">{h.rows.item}</dt><dd className="font-mono text-caption break-all">{auth.resource}</dd></>}
          {auth.detail && !showsContent(kind) && <><dt className="text-faint">{h.rows.detail}</dt><dd className="break-words">{auth.detail}</dd></>}
          <dt className="text-faint">{h.rows.id}</dt><dd className="font-mono text-caption break-all">{auth.id}</dd>
          <dt className="text-faint">{h.rows.asked}</dt><dd>{clock(auth.createdAt)}</dd>
          <dt className="text-faint">{h.rows.lapses}</dt><dd>{clock(lapsesAt)}</dd>
        </dl>
        <Link href="/oversight" className="mt-3 inline-block text-small text-primary underline-offset-4 hover:underline">{h.technical}</Link>
      </Disclosure>
    </article>
  );
}
