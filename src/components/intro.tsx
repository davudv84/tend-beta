"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useT } from "@/i18n/client";
import { clock } from "@/lib/format";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Place } from "@/sanctuary/occupancy";

const EASE = [0.2, 0, 0, 1] as const;

/**
 * A five-step live tour after the welcome: the world, a task, the record, a note, a human decision.
 * Every step points at real (simulated, labelled) events from the server; nothing is staged for it.
 */
export function Intro({ onPlace, onSelect }: { place?: Place; onPlace: (p: Place) => void; onSelect: (id: string | null) => void }) {
  const t = useT();
  const ready = useStore((s) => s.ready);
  const welcomed = useStore((s) => s.prefs.welcomeDone);
  const done = useStore((s) => s.prefs.introDone);
  const setPrefs = useStore((s) => s.setPrefs);
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const taskEvents = useStore((s) => s.taskEvents);
  const checkIns = useStore((s) => s.checkIns);
  const requests = useStore((s) => s.requests);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const [step, setStep] = useState(0);
  // Restarting the tour starts it from the beginning.
  const visible = ready && welcomed && !done;
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setStep(0);
  }

  const facts = useMemo(() => {
    const name = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
    const started = taskEvents.find((t) => t.type === "task.started" && tasks[t.agentId]?.taskId === t.taskId);
    const reflection = checkIns.find((c) => c.reflection);
    const pending = checkIns.filter((c) => c.review?.status === "pending").length + requests.filter((r) => r.review.status === "pending").length;
    return { name, started, latest: taskEvents[0], reflection, pending };
  }, [agents, tasks, taskEvents, checkIns, requests]);

  if (!visible) return null;
  const finish = () => {
    setPrefs({ introDone: true });
    onSelect(null);
  };

  const { name, started, latest, reflection, pending } = facts;
  const x = t.intro.steps;
  const steps: { title: string; body: string; action?: { label: string; run: () => void } }[] = [
    x.figures,
    started
      ? { title: x.taskLive.title, body: x.taskLive.body(clock(started.at), name(started.agentId), started.title ?? t.task.untitled), action: { label: x.show(name(started.agentId)), run: () => onSelect(started.agentId) } }
      : { ...x.taskNone, action: { label: x.lookStudy, run: () => onPlace("study") } },
    {
      ...(latest ? { title: x.recordLive.title, body: x.recordLive.body(name(latest.agentId), t.say.task[latest.type](latest.title ?? latest.taskId), latest.seq) } : x.recordNone),
      action: { label: x.openStudy, run: () => onPlace("study") },
    },
    { ...(reflection ? { title: x.noteLive.title, body: x.noteLive.body(name(reflection.agentId), reflection.reflection ?? "") } : x.noteNone), action: { label: x.visitLounge, run: () => onPlace("lounge") } },
    { title: x.human.title, body: x.human.body(pending, !canAct), action: { label: x.seeBoard, run: () => onPlace("spa") } },
  ];
  const s = steps[step];
  const last = step === steps.length - 1;

  return (
    <motion.aside
      role="region" aria-label={t.intro.region}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE, delay: 0.6 }}
      className={cn("absolute z-30 w-[min(360px,calc(100%-24px))] rounded-[8px] border border-border bg-background/95 shadow-[0_24px_48px_-24px_rgb(0_0_0/0.9)] backdrop-blur-md",
        "top-14 left-3 lg:top-auto lg:bottom-6 lg:left-1/2 lg:-translate-x-1/2")}
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="flex gap-1" aria-label={t.intro.step(step + 1, steps.length)}>
          {steps.map((_, i) => <span key={i} className={cn("h-1 w-4 transition-colors duration-300", i <= step ? "bg-sage" : "bg-border")} />)}
        </span>
        <span className="truncate pl-3 font-mono text-meta text-faint">{t.intro.tag}</span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.22, ease: EASE }} className="px-4 pt-3 pb-1">
          <h2 className="text-title">{s.title}</h2>
          <p className="mt-1.5 text-small leading-relaxed text-muted-foreground">{s.body}</p>
        </motion.div>
      </AnimatePresence>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-2 pb-3">
        <button onClick={finish} className="rounded-[4px] px-1.5 py-1 -ml-1.5 text-caption text-faint transition-colors hover:text-foreground">{t.intro.skip}</button>
        <div className="ml-auto flex gap-1.5">
          {s.action && (
            <button onClick={s.action.run} className="rounded-[5px] border border-border px-2.5 py-1.5 text-caption text-muted-foreground transition-colors hover:border-faint hover:text-foreground">{s.action.label}</button>
          )}
          <button onClick={() => (last ? finish() : setStep(step + 1))} className="rounded-[5px] bg-foreground px-3 py-1.5 text-caption font-medium text-background transition-opacity hover:opacity-90">
            {last ? t.intro.done : t.intro.next}
          </button>
        </div>
      </div>
    </motion.aside>
  );
}
