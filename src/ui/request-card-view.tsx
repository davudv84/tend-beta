"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/ui/disclosure";

export interface CardRow {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

/**
 * How a request that needs a person looks, with nothing behind it: the app's RequestCard (request-card.tsx) gives it a recorded request
 * and the store's decide, the homepage's demo gives it invented data and a local reducer. One markup, so the two cannot drift apart.
 */
export function RequestCardView({
  kind,
  loud,
  sentence,
  meta,
  exact,
  item,
  why,
  warning,
  step = "ask",
  confirm,
  labels,
  onAllow,
  onDeny,
  onConfirm,
  onBack,
  error,
  change,
  details,
  detailsOpen,
  detailsFooter,
  className,
}: {
  /** The kind of action, as a word (Spends money, Runs something on your computer…). */
  kind: string;
  /** Risky kinds are said in the foreground colour. */
  loud: boolean;
  sentence: string;
  /** "Asked 2m ago · Expires in 8 min". */
  meta: React.ReactNode;
  /** The exact content being decided; `mono` for a command, path or address as written. */
  exact?: { label: string; text: string; mono: boolean };
  item?: { label: string; value: string };
  why?: { label: string; value: string };
  warning?: string;
  step?: "ask" | "confirm" | "saving";
  confirm?: { title: string; body: string; yes: string; back: string };
  labels: { allow: string; deny: string; details: string; saving: string; promise: string };
  onAllow: () => void;
  onDeny: () => void;
  onConfirm?: () => void;
  onBack?: () => void;
  error?: string | null;
  /** The "Change what needs your OK" link (or a stand-in for it). */
  change: React.ReactNode;
  details: CardRow[];
  detailsOpen?: boolean;
  detailsFooter?: React.ReactNode;
  className?: string;
}) {
  const headingId = useId();
  const busy = step === "saving";
  const button = "h-11 rounded-full px-6 text-ui";
  return (
    <article aria-labelledby={headingId} aria-busy={busy} className={className ?? "rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgb(0_0_0/0.03)] md:p-6"}>
      {/* What kind of action it is comes first, as a word, so the risky ones are known before anything else is read. */}
      <p className={loud ? "text-small font-medium text-foreground" : "text-small text-muted-foreground"}>{kind}</p>
      <h3 id={headingId} className="mt-2 text-heading text-balance">{sentence}</h3>
      <p className="mt-2 text-small text-muted-foreground">{meta}</p>

      {/* The exact content. Never inside "Details": it is what the person is deciding. */}
      {exact && (
        <>
          <p className="mt-6 text-caption text-faint">{exact.label}</p>
          <blockquote className={`mt-2 rounded-2xl bg-sunken px-5 py-4 break-words whitespace-pre-wrap ${exact.mono ? "font-mono text-[14px] [overflow-wrap:anywhere]" : "text-body"}`}>{exact.text}</blockquote>
        </>
      )}

      {/* What it is, what it touches and which rule asked for a person, before the buttons rather than behind "Details". */}
      <dl className="mt-4 grid gap-x-5 gap-y-0.5 text-small sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-1.5">
        {item && <><dt className="text-faint">{item.label}</dt><dd className="mb-2 font-mono text-caption break-all sm:mb-0">{item.value}</dd></>}
        {why && <><dt className="text-faint">{why.label}</dt><dd className="text-pretty">{why.value}</dd></>}
      </dl>

      {warning && step === "ask" && <p role="note" className="mt-4 text-small font-medium text-foreground">{warning}</p>}

      {step === "confirm" && confirm ? (
        <div role="group" aria-label={confirm.title} className="mt-6 rounded-2xl border border-border p-5">
          <p className="text-ui font-medium">{confirm.title}</p>
          <p className="mt-1 text-small text-muted-foreground">{confirm.body}</p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Button className={button} disabled={busy} onClick={onConfirm}>{confirm.yes}</Button>
            <Button variant="ghost" className={button} disabled={busy} onClick={onBack}>{confirm.back}</Button>
          </div>
        </div>
      ) : (
        <div data-slot="request-actions" className="mt-6 flex flex-wrap gap-2.5">
          <Button className={button} disabled={busy} onClick={onAllow}>{labels.allow}</Button>
          <Button variant="secondary" className={`${button} border-border`} disabled={busy} onClick={onDeny}>{labels.deny}</Button>
        </div>
      )}
      <p role="status" className={busy ? "mt-3 text-small text-muted-foreground" : "sr-only"}>{busy ? labels.saving : ""}</p>
      {error && <p role="alert" className="mt-3 text-small text-clay">{error}</p>}

      <p className="mt-5 text-caption text-faint">{labels.promise} {change}</p>

      <Disclosure summary={labels.details} open={detailsOpen} className="mt-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-border pt-3 text-small">
          {details.map((r) => <Row key={r.label} {...r} />)}
        </dl>
        {detailsFooter}
      </Disclosure>
    </article>
  );
}

function Row({ label, value, mono }: CardRow) {
  return <><dt className="text-faint">{label}</dt><dd className={mono ? "font-mono text-caption break-all" : "break-words"}>{value}</dd></>;
}
