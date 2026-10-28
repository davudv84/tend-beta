"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeftIcon, FileQuestionIcon } from "lucide-react";
import { ReviewBadge } from "@/components/feed";
import { AgentAvatar, OriginTag, Empty, Panel } from "@/components/kit";
import { AdjustmentBlock, ReviewActions } from "@/components/review";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { QUESTIONS } from "@/lib/contract";
import { checkInEvent } from "@/lib/derive";
import { dateTime, timeAgo, useNow } from "@/lib/format";
import { useAgent, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export default function View() {
  const t = useT();
  const g = t.reportPage;
  const { id } = useParams<{ id: string }>();
  const checkIn = useStore((s) => s.checkIns.find((c) => c.id === id));
  const agent = useAgent(checkIn?.agentId ?? "");
  const now = useNow();

  if (!checkIn || !agent)
    return (
      <Empty icon={FileQuestionIcon} title={g.notFound} body={g.notFoundBody}
        action={<Button asChild variant="outline"><Link href="/check-ins">{g.all}</Link></Button>} />
    );

  const review = checkIn.review;

  return (
    <div>
      <Link href="/check-ins" className="mb-8 inline-flex items-center gap-1.5 text-small text-faint transition-colors hover:text-foreground">
        <ArrowLeftIcon className="size-3.5" /> {g.back}
      </Link>

      <header className="mb-10">
        <p className="eyebrow mb-3">{t.reportsPage.eyebrow}</p>
        <div className="flex flex-wrap items-center gap-3">
          <AgentAvatar agent={agent} />
          <h1 className="text-display leading-tight font-semibold">
            <Link href={`/agents/${agent.id}`} className="hover:underline">{agent.name}</Link>{" "}
            <span className="text-muted-foreground">{t.say[checkInEvent(checkIn).say.k]}</span>
          </h1>
          <ReviewBadge status={review?.status} />
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-faint">
          <span>{dateTime(checkIn.createdAt)} · {timeAgo(checkIn.createdAt, now)}</span>
          <span className="font-mono">{checkIn.id}</span>
          <span className="font-mono">{t.common.source(t.sources[checkIn.source])}</span>
          <OriginTag agent={agent} />
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid content-start gap-6">
          <ol className="frame overflow-hidden">
            {QUESTIONS.map((q, i) => {
              const r = checkIn.responses[q.id];
              const concern = q.concern.includes(r.answer);
              return (
                <li key={q.id} className="flex gap-4 border-b border-border p-5 last:border-0">
                  <span className="pt-0.5 font-mono text-xs text-faint">{t.q(i + 1)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-small text-faint">{t.questions[q.id].text}</p>
                    <div className="mt-2 flex items-center gap-4">
                      <span className={cn("text-ui font-medium", concern && "text-amber")}>{t.answers[r.answer]}</span>
                      <span className="flex flex-1 items-center gap-2.5" title={g.confidenceTitle}>
                        <span className="h-1 max-w-40 flex-1 overflow-hidden rounded-full bg-elevated">
                          <span className="block h-full rounded-full bg-muted-foreground/60" style={{ width: `${r.confidence}%` }} />
                        </span>
                        <span className="font-mono text-xs whitespace-nowrap text-faint tabular-nums">{g.confidence(r.confidence)}</span>
                      </span>
                    </div>
                    {r.explanation && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{r.explanation}</p>}
                  </div>
                </li>
              );
            })}
          </ol>

          {checkIn.reflection && (
            <figure className="border-t border-border pt-5">
              <p className="eyebrow">{g.note}</p>
              <blockquote className="quote mt-3 max-w-[36em] text-quote-lg">{t.quote(checkIn.reflection)}</blockquote>
              <figcaption className="mt-3 text-caption text-faint">{g.noteCaption} <Link href={`/reflections?agent=${checkIn.agentId}`} className="underline underline-offset-2 hover:text-muted-foreground">{g.allNotes(agent.name)}</Link></figcaption>
            </figure>
          )}

          <Panel title={g.feedbackContext}>
            {t.common.originalLanguage && <p className="-mt-2 mb-4 text-caption text-faint">{t.common.originalLanguage}</p>}
            <dl className="grid gap-4 text-sm">
              <div>
                <dt className="text-small text-faint">{g.feedback}</dt>
                <dd className="mt-1 leading-relaxed text-muted-foreground">{checkIn.feedback || g.noneGiven}</dd>
              </div>
              <div>
                <dt className="text-small text-faint">{g.context}</dt>
                <dd className="mt-1 leading-relaxed text-muted-foreground">{checkIn.context || g.noneGiven}</dd>
              </div>
            </dl>
          </Panel>
        </div>

        <aside className="grid content-start gap-6">
          <AdjustmentBlock checkIn={checkIn} />
          <Panel title={g.humanReview}>
            {!review && <p className="text-sm leading-relaxed text-muted-foreground">{g.noReview}</p>}
            {review?.status === "pending" && (
              <>
                <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{g.pendingNote}</p>
                <ReviewActions checkIn={checkIn} agent={agent} />
              </>
            )}
            {review && review.status !== "pending" && (
              <div className="text-sm">
                <p className="text-muted-foreground"><ReviewBadge status={review.status} /> <span className="ml-1.5">{review.decidedAt && dateTime(review.decidedAt)}</span></p>
                {review.note && <p className="mt-3 leading-relaxed text-muted-foreground">{t.quote(review.note)}</p>}
              </div>
            )}
          </Panel>
          <p className="px-1 text-xs leading-relaxed text-faint">{g.footnote(checkIn.source !== "agent")}</p>
        </aside>
      </div>
    </div>
  );
}
