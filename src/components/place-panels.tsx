"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRightIcon } from "lucide-react";
import { describe } from "@/components/agent-callout";
import { Feed, ReviewBadge } from "@/components/feed";
import { AnswerGlyphs, Dot, OriginTag } from "@/components/kit";
import { AdjustmentBlock, ReviewActions } from "@/components/review";
import { useT } from "@/i18n/client";
import type { Dict } from "@/i18n";
import { QUESTIONS } from "@/lib/contract";
import { DAY, timeline } from "@/lib/derive";
import { clock, dateTime, duration, timeAgo, useNow } from "@/lib/format";
import { journal } from "@/lib/reflections";
import { useStore } from "@/lib/store";
import type { Agent, CheckIn, ReviewRequest, TaskEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { identity } from "@/sanctuary/actors";
import { AgentFigure } from "@/sanctuary/figure";
import { kindOf, occupants, roomAgent, type Place } from "@/sanctuary/occupancy";

type Props = { place: Place; inspected: string | null; onInspect: (id: string | null) => void; onSelect: (id: string | null) => void };

const EASE = [0.2, 0, 0, 1] as const;
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const uncertainty = (c: CheckIn) => Math.round(QUESTIONS.reduce((s, q) => s + (100 - c.responses[q.id].confidence), 0) / QUESTIONS.length);

function useBasics() {
  const t = useT();
  const agents = useStore((s) => s.agents);
  const skew = useStore((s) => s.skew);
  const now = useNow() + skew;
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  return { t, p: t.panels, agents, now, byId };
}

// ---- shared pieces -------------------------------------------------------------------------------

function Block({ title, note, children, action, className }: { title?: string; note?: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("px-5 py-4 md:px-6", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {title && <h3 className="eyebrow">{title}</h3>}
          {action}
        </div>
      )}
      {note && <p className={cn("mb-3 text-caption text-faint", title && "-mt-2")}>{note}</p>}
      {children}
    </section>
  );
}

/** Two or three figures that summarise a place at a glance. */
function Readouts({ items }: { items: { n: number | string; label: string; tone?: "amber" | "sage" }[] }) {
  return (
    <dl className="mx-5 grid grid-flow-col gap-px overflow-hidden rounded-[4px] border border-border bg-border md:mx-6" style={{ gridAutoColumns: "1fr" }}>
      {items.map((i) => (
        <div key={i.label} className="flex flex-col-reverse bg-surface px-3 py-2.5">
          <dt className="mt-1.5 text-caption leading-tight text-faint">{i.label}</dt>
          <dd className={cn("numeric text-h2 leading-none", i.tone === "amber" && Number(i.n) > 0 ? "text-amber" : i.tone === "sage" && Number(i.n) > 0 ? "text-sage" : "text-foreground")}>{i.n}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A thing in the room you can open, as a quiet row. */
function ObjectRow({ id, title, meta, inspected, onInspect }: { id: string; title: string; meta: string; inspected: string | null; onInspect: (id: string | null) => void }) {
  const on = inspected === id;
  return (
    <button onClick={() => onInspect(on ? null : id)} aria-pressed={on}
      className={cn("group flex w-full items-center gap-3 rounded-[4px] px-2 py-2 text-left transition-colors", on ? "bg-elevated" : "hover:bg-elevated/60")}>
      <span className={cn("size-1.5 shrink-0 transition-colors", on ? "bg-sage" : "bg-faint/60 group-hover:bg-muted-foreground")} />
      <span className="min-w-0 flex-1 truncate text-small">{title}</span>
      <span className="shrink-0 font-mono text-meta text-faint">{meta}</span>
    </button>
  );
}

function People({ ids, byId, empty, onSelect }: { ids: string[]; byId: Map<string, Agent>; empty: string; onSelect: (id: string | null) => void }) {
  if (!ids.length) return <p className="text-small text-faint">{empty}</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <li key={id}>
          <button onClick={() => onSelect(id)} className="flex items-center gap-2 rounded-[4px] border border-border py-1 pr-2.5 pl-1.5 text-small transition-colors hover:border-faint hover:bg-elevated/60">
            <AgentFigure id={id} crop scale={2} />{byId.get(id)?.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A compact vertical timeline: time, a node on a rail, the line. */
function Rail({ items }: { items: { id: string; at: number; tone?: "sage" | "amber" | "muted"; text: React.ReactNode; note?: string; onClick?: () => void }[] }) {
  return (
    <ol className="relative">
      <span aria-hidden className="absolute top-2 bottom-2 left-[47px] w-px bg-border" />
      {items.map((e) => {
        const body = (
          <>
            <time className="w-9 shrink-0 pt-px font-mono text-meta text-faint tabular-nums">{clock(e.at)}</time>
            <span className={cn("relative z-10 mt-[5px] size-[5px] shrink-0", e.tone === "amber" ? "bg-amber" : e.tone === "sage" ? "bg-sage" : "bg-faint")} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-small text-muted-foreground">{e.text}</span>
              {e.note && <span className="block truncate text-caption text-faint">{e.note}</span>}
            </span>
          </>
        );
        return (
          <li key={e.id}>
            {e.onClick ? (
              <button onClick={e.onClick} className="flex w-full gap-2.5 rounded-[3px] py-1.5 text-left transition-colors hover:bg-elevated/50">{body}</button>
            ) : (
              <div className="flex gap-2.5 py-1.5">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const taskItem = (t: Dict, e: TaskEvent, agent: Agent | undefined, onInspect?: (id: string) => void) => ({
  id: e.id, at: e.at, tone: e.type === "task.failed" || (e.outcome && e.outcome !== "success") ? ("amber" as const) : e.type === "task.started" ? ("sage" as const) : ("muted" as const),
  text: <><span className="text-foreground">{agent?.name ?? e.agentId}</span> {t.say.task[e.type](e.title)}</>,
  note: e.error ?? e.summary,
  onClick: onInspect ? () => onInspect(`event:${e.id}`) : undefined,
});

/** The detail drawer: replaces the overview with one object's record, with a way back. */
function Detail({ title, onBack, back, children }: { title: string; onBack: () => void; back: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-5 pt-1 md:px-6">
        <button onClick={onBack} className="-ml-1.5 rounded-[3px] px-1.5 py-1 text-caption text-faint transition-colors hover:bg-elevated hover:text-foreground">← {back}</button>
        <h3 className="pt-1 text-title">{title}</h3>
      </div>
      {children}
    </div>
  );
}

/** Cross-fades and slides between a place's overview and an object's record. */
function Swap({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={k} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.22, ease: EASE }}>{children}</motion.div>
    </AnimatePresence>
  );
}

/** The full stored record of one task event. */
function TaskEventDetail({ e, agent }: { e: TaskEvent; agent?: Agent }) {
  const r = useT().panels.rows, src = useT().task.source;
  const rows: [string, string | undefined, boolean?][] = [
    [r.event, e.type, true], [r.taskId, e.taskId, true], [r.title, e.title], [r.detail, e.detail], [r.summary, e.summary], [r.error, e.error],
    [r.agent, agent ? `${agent.name} · ${agent.model}` : e.agentId], [r.source, src[e.source]], [r.received, dateTime(e.at)], [r.id, e.id, true], [r.seq, String(e.seq), true],
  ];
  return (
    <dl className="mx-5 mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 rounded-[4px] border border-border bg-surface px-4 py-3 text-small md:mx-6">
      {rows.filter(([, v]) => v).map(([k, v, mono]) => (
        <div key={k} className="contents">
          <dt className="text-faint">{k}</dt>
          <dd className={cn("min-w-0 break-words text-muted-foreground", mono && "font-mono text-meta leading-5")}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---- the study -------------------------------------------------------------------------------

function StudyPanel({ place, inspected, onInspect, onSelect }: Props) {
  const { t, p, agents, now, byId } = useBasics();
  const tasks = useStore((s) => s.tasks);
  const checkIns = useStore((s) => s.checkIns);
  const taskEvents = useStore((s) => s.taskEvents);
  const working = occupants(place, agents, tasks, checkIns, now);
  const today = taskEvents.filter((t) => t.at > now - DAY);
  const done = taskEvents.filter((t) => t.type === "task.completed" || t.type === "task.failed");
  // The browser keeps the latest 500 task events; when they all fall within the day, counts are lower bounds.
  const capped = taskEvents.length >= 500 && taskEvents[taskEvents.length - 1].at > now - DAY;
  const n = (v: number) => (capped ? `${v}+` : v);
  const back = () => onInspect(null);

  if (inspected?.startsWith("event:")) {
    const e = taskEvents.find((x) => x.id === inspected.slice(6));
    return (
      <Detail title={e ? t.task.headline[e.type](byId.get(e.agentId)?.name ?? e.agentId) : p.rows.event} back={t.places.study} onBack={back}>
        {e ? <TaskEventDetail e={e} agent={byId.get(e.agentId)} /> : <p className="px-6 pt-3 text-small text-faint">{p.olderEvent}</p>}
      </Detail>
    );
  }
  if (inspected?.startsWith("desk-")) {
    const n = Number(inspected.slice(5)), id = working[n], a = id ? byId.get(id) : undefined, task = id ? tasks[id] : undefined;
    return (
      <Detail title={t.objects.desk(n + 1)[0]} back={t.places.study} onBack={back}>
        {a && task ? (
          <>
            <Block>
              <button onClick={() => onSelect(a.id)} className="flex items-center gap-3 text-left">
                <AgentFigure id={a.id} crop scale={3} />
                <span><span className="block text-ui font-medium">{a.name}</span><span className="block font-mono text-meta text-faint">{a.model}</span></span>
                <OriginTag agent={a} className="ml-1" />
              </button>
              <div className="mt-4 rounded-[4px] border border-border bg-surface px-4 py-3">
                <p className="text-ui">{task.title || t.task.untitled}</p>
                {task.detail && <p className="mt-1 text-small text-muted-foreground">{task.detail}</p>}
                <p className="mt-2 font-mono text-meta text-faint">{task.taskId} · {p.started(clock(task.startedAt), duration(task.startedAt, now))}</p>
              </div>
            </Block>
            <Block title={p.agentEvents} note={p.selectRecord}>
              <Rail items={taskEvents.filter((e) => e.agentId === id).slice(0, 8).map((e) => taskItem(t, e, a, onInspect))} />
            </Block>
          </>
        ) : (
          <p className="px-6 pt-3 text-small text-muted-foreground">{p.deskVacant[0]} <code className="font-mono text-meta">task.started</code> {p.deskVacant[1]}</p>
        )}
      </Detail>
    );
  }
  if (inspected === "shelf" || inspected === "board") {
    const list = inspected === "shelf" ? done.slice(0, 30) : taskEvents.slice(0, 40);
    return (
      <Detail title={inspected === "shelf" ? p.completed : p.board} back={t.places.study} onBack={back}>
        <Block note={inspected === "shelf" ? p.completedNote : p.boardNote}>
          {list.length ? <Rail items={list.map((e) => taskItem(t, e, byId.get(e.agentId), onInspect))} /> : <p className="text-small text-faint">{p.nothingYet}</p>}
        </Block>
      </Detail>
    );
  }
  if (inspected === "rack")
    return (
      <Detail title={p.rack} back={t.places.study} onBack={back}>
        <Block>
          <p className="text-body text-muted-foreground">{p.rackBody(working.length)}</p>
        </Block>
      </Detail>
    );

  return (
    <>
      <Readouts items={[{ n: working.length, label: p.inProgress, tone: "sage" }, { n: n(today.filter((e) => e.type === "task.completed").length), label: p.completedToday }, { n: n(today.filter((e) => e.type === "task.failed").length), label: p.failedToday, tone: "amber" }]} />
      <Block title={p.desks} note={working.length > 4 ? p.noDesk(working.length - 4) : undefined}>
        <div className="grid grid-cols-2 gap-1.5">
          {[0, 1, 2, 3].map((i) => {
            const id = working[i], a = id ? byId.get(id) : undefined, task = id ? tasks[id] : undefined;
            return (
              <button key={i} onClick={() => onInspect(`desk-${i}`)} aria-pressed={inspected === `desk-${i}`}
                className={cn("flex min-h-[74px] flex-col gap-1.5 rounded-[4px] border p-2.5 text-left transition-colors", a ? "border-border bg-surface hover:border-faint" : "border-dashed border-border/70 hover:border-border")}>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-meta text-faint">{p.desk(i + 1)}</span>
                  {a && <span className="size-1.5 bg-sage" aria-hidden />}
                </span>
                {a && task ? (
                  <>
                    <span className="flex min-w-0 items-center gap-1.5 text-small font-medium"><AgentFigure id={a.id} crop scale={1} />{a.name}</span>
                    <span className="line-clamp-2 text-caption leading-snug text-muted-foreground">{task.title || t.task.untitled}</span>
                  </>
                ) : <span className="text-caption text-faint">{p.vacant}</span>}
              </button>
            );
          })}
        </div>
      </Block>
      <Block title={p.inRoom}>
        <ObjectRow id="board" title={t.objects.study.board[0]} meta={p.today(n(today.length))} inspected={inspected} onInspect={onInspect} />
        <ObjectRow id="shelf" title={t.objects.study.shelf[0]} meta={p.doneCount(n(done.length))} inspected={inspected} onInspect={onInspect} />
        <ObjectRow id="rack" title={t.objects.study.rack[0]} meta={p.lit(working.length)} inspected={inspected} onInspect={onInspect} />
      </Block>
      <Block title={p.latest} action={<button onClick={() => onInspect("board")} className="text-caption text-faint hover:text-foreground">{p.allEvents}</button>}>
        <Rail items={taskEvents.slice(0, 5).map((e) => taskItem(t, e, byId.get(e.agentId), onInspect))} />
      </Block>
    </>
  );
}

// ---- the reflection lounge -------------------------------------------------------------------

/** The journal shelf: one spine per agent in its colours, taller with every reflection it has written. */
function JournalShelf({ agents, counts, inspected, onInspect }: { agents: Agent[]; counts: Map<string, number>; inspected: string | null; onInspect: (id: string | null) => void }) {
  const p = useT().panels;
  const max = Math.max(1, ...counts.values());
  return (
    <div>
      <ul className="flex h-[92px] items-end gap-1 border-b-[3px] border-[#5c4129] px-2">
        {agents.map((a) => {
          const me = identity(a.id), n = counts.get(a.id) ?? 0, on = inspected === `journal-${a.id}`;
          return (
            <li key={a.id} className="flex items-end"><button onClick={() => onInspect(on ? null : `journal-${a.id}`)} aria-pressed={on}
              aria-label={p.journalLabel(a.name, n)} title={`${a.name} · ${p.notesCount(n)}`}
              className={cn("relative flex w-7 flex-col items-center justify-between rounded-t-[2px] py-1.5 transition-transform duration-200 ease-out hover:-translate-y-1 focus-visible:-translate-y-1", on && "-translate-y-2")}
              style={{ height: 44 + Math.round((n / max) * 36), background: hex(me.robe), boxShadow: on ? "0 0 0 1px var(--sage)" : undefined }}>
              <span className="h-[3px] w-4" style={{ background: hex(me.trim) }} />
              <span className="font-mono text-[10px] font-medium uppercase" style={{ color: hex(me.trim) }}>{a.name.slice(0, 2)}</span>
              <span className="h-[3px] w-4" style={{ background: hex(me.trim) }} />
            </button></li>
          );
        })}
      </ul>
      <p className="mt-2 text-caption text-faint">{p.journalHint}</p>
    </div>
  );
}

function Quote({ c, number, agent, now }: { c: CheckIn; number: string; agent?: Agent; now: number }) {
  const t = useT();
  return (
    <figure className="border-l-2 pl-3" style={{ borderColor: agent ? hex(identity(agent.id).robe) : undefined }}>
      <blockquote className="quote text-body text-foreground/90">{t.quote(c.reflection ?? "")}</blockquote>
      <figcaption className="mt-1.5 font-mono text-meta text-faint">{agent?.name} · {t.world.note(number)} · {timeAgo(c.createdAt, now)} · {t.sources[c.source]}</figcaption>
    </figure>
  );
}

function CheckInLine({ c, agent }: { c: CheckIn; agent?: Agent }) {
  const t = useT();
  return (
    <li>
      <Link href={`/check-ins/${c.id}`} className="group flex items-center gap-3 rounded-[3px] py-1.5 transition-colors hover:bg-elevated/50">
        <span className="w-9 shrink-0 font-mono text-meta text-faint tabular-nums">{clock(c.createdAt)}</span>
        <span className="min-w-0 flex-1 truncate text-small text-muted-foreground"><span className="text-foreground">{agent?.name}</span> {c.feedback || t.say.checkIn}</span>
        <AnswerGlyphs checkIn={c} />
        {c.review && <ReviewBadge status={c.review.status} />}
      </Link>
    </li>
  );
}

function LoungePanel({ place, inspected, onInspect, onSelect }: Props) {
  const { t, p, agents, now, byId } = useBasics();
  const tasks = useStore((s) => s.tasks);
  const checkIns = useStore((s) => s.checkIns);
  const requests = useStore((s) => s.requests);
  const entries = useMemo(() => journal(checkIns), [checkIns]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.checkIn.agentId, (m.get(e.checkIn.agentId) ?? 0) + 1);
    return m;
  }, [entries]);
  const here = occupants(place, agents, tasks, checkIns, now);
  const back = () => onInspect(null);

  if (inspected?.startsWith("journal-")) {
    const id = inspected.slice(8), a = byId.get(id), mine = entries.filter((e) => e.checkIn.agentId === id);
    return (
      <Detail title={p.journalTitle(a?.name ?? t.common.agent)} back={t.places.lounge} onBack={back}>
        <Block note={p.journalNote(mine.length)}>
          <div className="grid gap-5">
            {mine.slice(0, 6).map(({ checkIn: c, number }) => <Quote key={c.id} c={c} number={number} agent={a} now={now} />)}
            {!mine.length && <p className="text-small text-faint">{p.noNotes}</p>}
          </div>
          <Link href={`/reflections?agent=${id}`} className="mt-5 inline-flex items-center gap-1 text-small text-muted-foreground hover:text-foreground">{p.openNotes} <ArrowUpRightIcon className="size-3.5" /></Link>
        </Block>
      </Detail>
    );
  }
  if (inspected === "alcove")
    return (
      <Detail title={p.alcoveTitle} back={t.places.lounge} onBack={back}>
        <Block>
          <p className="text-body text-muted-foreground">{p.alcoveBody}</p>
          <Link href="/reflections" className="mt-4 inline-flex items-center gap-1 text-small text-muted-foreground hover:text-foreground">{p.readNotes} <ArrowUpRightIcon className="size-3.5" /></Link>
        </Block>
      </Detail>
    );
  if (inspected === "table")
    return (
      <Detail title={p.historyTitle} back={t.places.lounge} onBack={back}>
        <Block note={p.historyNote}>
          <ul>{checkIns.slice(0, 18).map((c) => <CheckInLine key={c.id} c={c} agent={byId.get(c.agentId)} />)}</ul>
          <Link href="/check-ins" className="mt-3 inline-flex items-center gap-1 text-small text-muted-foreground hover:text-foreground">{p.allReports} <ArrowUpRightIcon className="size-3.5" /></Link>
        </Block>
      </Detail>
    );
  if (inspected === "library" || inspected === "shelf")
    return (
      <Detail title={inspected === "library" ? p.library : p.chest} back={t.places.lounge} onBack={back}>
        <Block note={p.byAgent}>
          <ul className="grid gap-1">
            {agents.map((a) => (
              <li key={a.id}>
                <button onClick={() => onInspect(`journal-${a.id}`)} className="flex w-full items-center gap-3 rounded-[3px] py-1.5 text-left transition-colors hover:bg-elevated/50">
                  <span className="h-4 w-1.5" style={{ background: hex(identity(a.id).robe) }} />
                  <span className="flex-1 text-small">{a.name}</span>
                  <span className="font-mono text-meta text-faint">{counts.get(a.id) ?? 0}</span>
                </button>
              </li>
            ))}
          </ul>
        </Block>
      </Detail>
    );

  const hour = checkIns.filter((c) => c.createdAt > now - 3_600_000).length;
  const pending = checkIns.filter((c) => c.review?.status === "pending").length + requests.filter((r) => r.review.status === "pending").length;
  const latest = entries[0];
  return (
    <>
      <Readouts items={[{ n: hour, label: p.reportsHour }, { n: entries.filter((e) => e.checkIn.createdAt > now - DAY).length, label: p.notesToday, tone: "sage" }, { n: pending, label: p.awaiting, tone: "amber" }]} />
      <Block title={p.journals}>
        <JournalShelf agents={agents} counts={counts} inspected={inspected} onInspect={onInspect} />
      </Block>
      <Block title={p.atTable} note={p.atTableNote}>
        <People ids={here} byId={byId} empty={p.noneAtTable} onSelect={onSelect} />
      </Block>
      {latest && (
        <Block title={p.latestNote} note={t.common.originalLanguage || undefined}>
          <Quote c={latest.checkIn} number={latest.number} agent={byId.get(latest.checkIn.agentId)} now={now} />
        </Block>
      )}
      <Block title={p.inRoom}>
        <ObjectRow id="table" title={p.teaTable} meta={p.reports} inspected={inspected} onInspect={onInspect} />
        <ObjectRow id="library" title={p.libraryRow} meta={p.notesCount(entries.length)} inspected={inspected} onInspect={onInspect} />
        <ObjectRow id="alcove" title={p.alcove} meta={p.about} inspected={inspected} onInspect={onInspect} />
      </Block>
    </>
  );
}

// ---- the wellness pavilion -------------------------------------------------------------------

type Pending = CheckIn | ReviewRequest;

function Slip({ p, agent, now, open, onToggle }: { p: Pending; agent: Agent; now: number; open: boolean; onToggle: () => void }) {
  const t = useT();
  const isCheckIn = "responses" in p;
  return (
    <li className={cn("rounded-[3px] border bg-[#e9dfc8] text-[#2a231c] shadow-[0_6px_14px_-10px_rgb(0_0_0/0.9)] transition-transform duration-200", open ? "border-sage/60" : "border-transparent hover:-translate-y-0.5")}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left">
        <span className="mt-1 size-1.5 shrink-0 bg-amber" />
        <span className="min-w-0 flex-1">
          <span className="block text-small font-medium">{agent.name}</span>
          <span className="block text-caption leading-snug text-[#4a4034]">{isCheckIn ? p.adjustment?.title ?? t.panels.askedInReport : p.reason}</span>
          <span className="mt-1 block font-mono text-meta text-[#6f6352]">{timeAgo(p.createdAt, now)} · {t.panels.slipKind(isCheckIn)} · {t.sources[p.source]}</span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24, ease: EASE }} className="overflow-hidden">
            <div className="grid gap-3 rounded-b-[3px] bg-surface px-3 py-3 text-foreground">
              {p.adjustment && <AdjustmentBlock checkIn={p} />}
              <ReviewActions checkIn={p} agent={agent} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function SpaPanel({ place, inspected, onInspect, onSelect }: Props) {
  const { t, p: x, agents, now, byId } = useBasics();
  const tasks = useStore((s) => s.tasks);
  const checkIns = useStore((s) => s.checkIns);
  const requests = useStore((s) => s.requests);
  const idle = occupants(place, agents, tasks, checkIns, now);
  const pending: Pending[] = useMemo(
    () => [...checkIns.filter((c) => c.review?.status === "pending"), ...requests.filter((r) => r.review.status === "pending")].sort((a, b) => b.createdAt - a.createdAt),
    [checkIns, requests],
  );
  const recent = checkIns.slice(0, 20);
  const mean = recent.length ? Math.round(recent.reduce((s, c) => s + uncertainty(c), 0) / recent.length) : 0;
  const top = Math.max(30, ...recent.map(uncertainty));
  const slipOpen = inspected?.startsWith("slip:") ? inspected.slice(5) : null;
  const back = () => onInspect(null);

  if (inspected === "ledger")
    return (
      <Detail title={x.ledger} back={t.places.spa} onBack={back}>
        <Block note={x.ledgerNote}>
          <table className="w-full text-small">
            <thead><tr className="text-left text-caption text-faint"><th className="pb-2 font-normal">{t.common.agent}</th><th className="pb-2 font-normal">{x.when}</th><th className="pb-2 text-right font-normal">{x.uncertainty}</th></tr></thead>
            <tbody>
              {checkIns.slice(0, 18).map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="py-1.5"><Link href={`/check-ins/${c.id}`} className="hover:underline">{byId.get(c.agentId)?.name}</Link></td>
                  <td className="py-1.5 font-mono text-meta text-faint">{clock(c.createdAt)}</td>
                  <td className="numeric py-1.5 text-right">{t.pct(uncertainty(c))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      </Detail>
    );

  const board = inspected === "board" || (slipOpen !== null && pending.findIndex((p) => p.id === slipOpen) >= 3);
  const slips = (
    <>
      {pending.length ? (
        <div className="rounded-[4px] bg-[#6e5238] p-2.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
          <ul className="grid gap-2">
            {pending.slice(0, board ? 12 : 3).map((p) => (
              <Slip key={p.id} p={p} agent={byId.get(p.agentId)!} now={now} open={slipOpen === p.id} onToggle={() => onInspect(slipOpen === p.id ? (board ? "board" : null) : `slip:${p.id}`)} />
            ))}
          </ul>
        </div>
      ) : <p className="text-small text-faint">{x.nothingWaiting}</p>}
    </>
  );
  if (board)
    return (
      <Detail title={x.noticeBoard} back={t.places.spa} onBack={back}>
        <Block note={x.boardWaiting(pending.length)}>{slips}</Block>
      </Detail>
    );
  return (
    <>
      <Readouts items={[{ n: pending.length, label: x.awaiting, tone: "amber" }, { n: idle.length, label: x.idleHere }, { n: t.pct(mean), label: x.meanUncertainty }]} />
      <Block title={x.noticeBoard} action={pending.length > 3 ? <button onClick={() => onInspect("board")} className="text-caption text-faint hover:text-foreground">{x.allN(pending.length)}</button> : undefined}>
        {slips}
      </Block>
      <Block title={x.statedUncertainty} action={<button onClick={() => onInspect("ledger")} className="text-caption text-faint hover:text-foreground">{x.ledger}</button>} note={x.last20(t.pct(top))}>
        <div className="flex h-14 items-end gap-[3px]" role="img" aria-label={x.meanLast20(t.pct(mean))}>
          {[...recent].reverse().map((c) => (
            <Link key={c.id} href={`/check-ins/${c.id}`} title={`${byId.get(c.agentId)?.name} · ${t.pct(uncertainty(c))}`} className="flex-1 bg-stone/40 transition-colors hover:bg-sage" style={{ height: `${Math.max(4, (uncertainty(c) / top) * 100)}%` }} />
          ))}
        </div>
      </Block>
      <Block title={x.waitingHere} note={x.waitingNote}>
        <People ids={idle} byId={byId} empty={x.noIdle} onSelect={onSelect} />
      </Block>
    </>
  );
}

// ---- an agent's room -------------------------------------------------------------------------

function RoomPanel({ place, inspected, onInspect }: Props) {
  const { t, p, now, byId } = useBasics();
  const tasks = useStore((s) => s.tasks);
  const checkIns = useStore((s) => s.checkIns);
  const requests = useStore((s) => s.requests);
  const taskEvents = useStore((s) => s.taskEvents);
  const log = useStore((s) => s.log);
  const id = roomAgent(place)!;
  const a = byId.get(id);
  if (!a) return <Block><p className="text-small text-muted-foreground">{p.noRoom}</p></Block>;
  const mine = checkIns.filter((c) => c.agentId === id);
  const d = describe(t, a, { working: !!tasks[id], now });
  const latest = mine[0];
  const reviews = [...mine.filter((c) => c.review?.status === "pending"), ...requests.filter((r) => r.agentId === id && r.review.status === "pending")];
  const me = identity(a.id);
  const focus = (...keys: string[]) => cn("rounded-[4px] transition-shadow", keys.includes(inspected ?? "") && "shadow-[0_0_0_1px_var(--sage)]");
  const live = a.origin === "connected" && d.code !== "offline";

  return (
    <>
      <div className={cn("mx-5 mt-1 flex items-start gap-4 border border-border bg-surface p-4 md:mx-6", focus("banner", "nameplate"))} style={{ borderLeft: `3px solid ${hex(me.robe)}` }}>
        <AgentFigure id={a.id} scale={3} />
        <div className="min-w-0">
          <p className="text-h2">{a.name}</p>
          <p className="mt-1 truncate font-mono text-meta text-faint">{a.model} · {a.provider}</p>
          <p className="mt-2"><OriginTag agent={a} /></p>
          <p className="mt-2 text-small text-muted-foreground">{a.role}</p>
        </div>
      </div>
      <Block>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-small">
          <dt className="text-faint">{p.status}</dt>
          <dd className={cn("flex flex-wrap items-center gap-2", focus("lantern"))}><Dot tone={reviews.length ? "amber" : d.code === "idle" || d.code === "working" ? "sage" : "off"} />{d.state}{reviews.length > 0 && <Link href="/oversight" className="text-amber underline-offset-2 hover:underline">· {p.toReview(reviews.length)}</Link>}</dd>
          <dt className="text-faint">{p.connection}</dt>
          <dd className={focus("link")}>{a.origin === "demo" ? p.bySimulation : live ? p.connectedHeard(a.lastSeenAt ? timeAgo(a.lastSeenAt, now) : t.common.never) : p.disconnected(a.lastSeenAt ? timeAgo(a.lastSeenAt, now) : undefined)}</dd>
          {a.origin === "connected" && <><dt className="text-faint">{p.config}</dt><dd className="font-mono text-meta text-muted-foreground">{p.applied(a.configVersion, a.ackedVersion < a.configVersion)}</dd></>}
          <dt className="text-faint">{p.permissions}</dt>
          <dd className={cn("flex flex-wrap gap-1.5", focus("keys"))}>
            {a.permissions.length ? a.permissions.map((perm) => <span key={perm} className="rounded-[3px] border border-amber/40 px-1.5 font-mono text-meta text-amber">{perm}</span>) : <span className="text-faint">{t.common.noneGranted}</span>}
          </dd>
        </dl>
      </Block>
      <Block title={p.recentTasks} className={focus("desk")}>
        {tasks[id] && <p className="mb-2 rounded-[3px] bg-elevated/60 px-2.5 py-1.5 text-small"><span className="text-faint">{p.now}</span> {tasks[id].title || t.task.untitled} <span className="font-mono text-meta text-faint">· {duration(tasks[id].startedAt, now)}</span></p>}
        {taskEvents.some((e) => e.agentId === id) ? <Rail items={taskEvents.filter((e) => e.agentId === id).slice(0, 5).map((e) => taskItem(t, e, a))} /> : <p className="text-small text-faint">{p.noTasks}</p>}
      </Block>
      <Block title={p.latestReport} className={focus("tray")}>
        {latest ? (
          <Link href={`/check-ins/${latest.id}`} className="block rounded-[3px] transition-colors hover:bg-elevated/40">
            <p className="flex items-center gap-3 text-small"><AnswerGlyphs checkIn={latest} /> <span className="text-faint">{timeAgo(latest.createdAt, now)}</span> {latest.review && <ReviewBadge status={latest.review.status} />}</p>
            {latest.feedback && <p className="mt-2 text-small text-muted-foreground">{latest.feedback}</p>}
          </Link>
        ) : <p className="text-small text-faint">{p.noReports}</p>}
      </Block>
      <Block title={p.activity} className={focus("calendar")} action={<Link href={`/agents/${id}`} className="text-caption text-faint hover:text-foreground">{p.fullHistory}</Link>}>
        <Feed events={timeline(mine.slice(0, 20), log.filter((l) => l.agentId === id), taskEvents.filter((t) => t.agentId === id)).slice(0, 6)} now={now} />
      </Block>
      {inspected && <button onClick={() => onInspect(null)} className="mx-6 mb-6 text-caption text-faint hover:text-foreground">{p.clear}</button>}
    </>
  );
}

/** The side panel for a building: an overview first; an object's record when one is selected. */
export function PlacePanel(props: Props) {
  const kind = kindOf(props.place);
  // Only the overview ↔ record switch animates; picking another slip or desk within a record doesn't.
  const k = kind === "room" || props.inspected?.startsWith("slip:") ? props.place : `${props.place}:${props.inspected ?? ""}`;
  return (
    <Swap k={k}>
      {kind === "study" ? <StudyPanel {...props} /> : kind === "lounge" ? <LoungePanel {...props} /> : kind === "spa" ? <SpaPanel {...props} /> : kind === "room" ? <RoomPanel {...props} /> : null}
    </Swap>
  );
}
