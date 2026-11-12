"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { CheckIcon, LockIcon, XIcon } from "lucide-react";
import { useReadOnlyReason } from "@/components/agent-callout";
import { AgentAvatar } from "@/components/kit";
import { ReviewBadge } from "@/components/feed";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n/error-text";
import { QUESTIONS } from "@/lib/contract";
import { checkInEvent } from "@/lib/derive";
import { dateTime, timeAgo } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Agent, CheckIn, ReviewRequest } from "@/lib/types";

export function AdjustmentBlock({ checkIn }: { checkIn: Pick<CheckIn, "adjustment"> }) {
  const t = useT();
  const a = checkIn.adjustment;
  if (!a) return null;
  return (
    <div className="rounded-lg border border-border bg-background/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow">{t.reviewUi.proposed(t.kinds[a.kind])}</span>
        {a.permission && (
          <span className="inline-flex items-center gap-1 rounded-[4px] bg-amber/10 px-1.5 py-px font-mono text-meta text-amber">
            <LockIcon className="size-3" /> {a.permission}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm font-medium">{a.title}</p>
      {a.detail && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{a.detail}</p>}
      <p className="mt-3 text-xs text-faint">{t.reviewUi.inert}</p>
    </div>
  );
}

/** Anything that can be reviewed: a check-in, or a standalone request. */
type Reviewable = Pick<CheckIn, "id" | "adjustment"> & { review?: CheckIn["review"]; approval?: true };

/** Human decision controls. Nothing is reported as done until the server confirms it. */
export function ReviewActions({ checkIn, agent }: { checkIn: Reviewable; agent: Agent }) {
  const t = useT();
  const r9 = t.reviewUi;
  const decide = useStore((s) => s.decide);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const readOnly = useReadOnlyReason();
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (checkIn.review?.status !== "pending") return null;
  const permission = checkIn.adjustment?.permission;

  const act = async (status: "approved" | "rejected" | "acknowledged") => {
    setBusy(true);
    const r = await decide(checkIn.id, status, note.trim() || undefined);
    setBusy(false);
    if (!r.ok) return toast.error(r9.notRecorded, { description: errorText(t, r) });
    const msg = { approved: permission ? r9.granted(permission, agent.name) : r9.approved, rejected: r9.rejected, acknowledged: r9.acknowledged }[status];
    toast.success(msg, {
      description:
        status === "approved" && permission && agent.origin === "connected" ? r9.grantConnected
          : status === "approved" && !permission ? r9.approvedNote
            : r9.recorded,
    });
  };

  if (!canAct) return <p className="text-small text-faint">{readOnly}</p>;

  return (
    <div className="grid gap-3">
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={r9.notePlaceholder} className="min-h-16 resize-none bg-background/60 text-sm" maxLength={500} aria-label={r9.noteLabel} />
      <div className="flex flex-wrap gap-2">
        {checkIn.adjustment || checkIn.approval ? (
          <>
            <Button size="lg" disabled={busy} onClick={() => (permission ? setConfirm(true) : act("approved"))}><CheckIcon /> {r9.approve}</Button>
            <Button size="lg" disabled={busy} variant="outline" onClick={() => act("rejected")}><XIcon /> {r9.reject}</Button>
            <Button size="lg" disabled={busy} variant="ghost" onClick={() => act("acknowledged")} className="text-muted-foreground">{r9.ackOnly}</Button>
          </>
        ) : (
          <Button size="lg" disabled={busy} onClick={() => act("acknowledged")}><CheckIcon /> {r9.markReviewed}</Button>
        )}
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{r9.grantTitle(permission ?? "", agent.name)}</AlertDialogTitle>
            <AlertDialogDescription>
              {r9.grantBody(agent.name)}
              {agent.origin === "connected" && r9.grantRuntime}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => act("approved")}>{r9.grant}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** A standalone review request (sent with review.requested, not inside a check-in). */
export function RequestCard({ request, agent, now }: { request: ReviewRequest; agent: Agent; now: number }) {
  const t = useT();
  return (
    <article className="min-w-0 frame">
      <header className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <AgentAvatar agent={agent} size="sm" />
        <p className="min-w-0 flex-1 truncate text-sm">
          <Link href={`/agents/${agent.id}`} className="font-medium hover:underline">{agent.name}</Link> <span className="text-muted-foreground">{t.say.review}</span>
        </p>
        <ReviewBadge status={request.review.status} />
        <time className="hidden font-mono text-xs text-faint sm:block" title={dateTime(request.createdAt)}>{timeAgo(request.createdAt, now)}</time>
      </header>
      <div className="grid gap-5 p-5 md:grid-cols-[1fr_minmax(0,22rem)]">
        <div>
          <p className="text-small text-faint">{t.reviewUi.reason}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{request.reason}</p>
          <p className="mt-3 font-mono text-meta text-faint">{t.common.source(t.sources[request.source])}</p>
        </div>
        <div className="grid content-start gap-4">
          {request.adjustment && <AdjustmentBlock checkIn={request} />}
          <ReviewActions checkIn={request} agent={agent} />
        </div>
      </div>
    </article>
  );
}

/** A pending item in the review queue: what the agent reported, and the decision controls. */
export function ReviewCard({ checkIn, agent, now }: { checkIn: CheckIn; agent: Agent; now: number }) {
  const t = useT();
  const concerns = QUESTIONS.filter((q) => q.concern.includes(checkIn.responses[q.id].answer));
  return (
    <article className="min-w-0 frame">
      <header className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <AgentAvatar agent={agent} size="sm" />
        <p className="min-w-0 flex-1 truncate text-sm">
          <Link href={`/agents/${agent.id}`} className="font-medium hover:underline">{agent.name}</Link>{" "}
          <span className="text-muted-foreground">{t.say[checkInEvent(checkIn).say.k]}</span>
        </p>
        <ReviewBadge status={checkIn.review?.status} />
        <time className="hidden font-mono text-xs text-faint sm:block" title={dateTime(checkIn.createdAt)}>{timeAgo(checkIn.createdAt, now)}</time>
      </header>
      <div className="grid gap-5 p-5 md:grid-cols-[1fr_minmax(0,22rem)]">
        <div className="grid content-start gap-4">
          {concerns.map((q) => {
            const r = checkIn.responses[q.id];
            return (
              <div key={q.id}>
                <p className="text-small text-faint">{t.questions[q.id].text}</p>
                <p className="mt-1 text-sm">
                  <span className="font-medium">{t.answers[r.answer]}</span>
                  <span className="ml-2 font-mono text-xs text-faint">{t.reviewUi.confidence(r.confidence)}</span>
                </p>
                {r.explanation && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{r.explanation}</p>}
              </div>
            );
          })}
          {checkIn.feedback && (
            <div>
              <p className="text-small text-faint">{t.reviewUi.freeText}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{checkIn.feedback}</p>
            </div>
          )}
          <Link href={`/check-ins/${checkIn.id}`} className="w-fit text-small text-faint underline-offset-4 hover:text-muted-foreground hover:underline">{t.reviewUi.viewFull}</Link>
        </div>
        <div className="grid content-start gap-4">
          <AdjustmentBlock checkIn={checkIn} />
          <ReviewActions checkIn={checkIn} agent={agent} />
        </div>
      </div>
    </article>
  );
}
