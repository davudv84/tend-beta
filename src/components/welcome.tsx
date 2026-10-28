"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRightIcon } from "lucide-react";
import { Glyph } from "@/components/glyph";
import type { GlyphName } from "@/components/glyphs";
import { LanguageSwitch } from "@/components/language-switch";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { useStore } from "@/lib/store";
import type { Agent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AgentFigure } from "@/sanctuary/figure";

const EASE = [0.2, 0, 0, 1] as const;
const GLYPH: GlyphName[] = ["mark", "agents", "sanctuary", "sanctuary", "timeline", "oversight", "agents"];

/** The picture above each step: the real agents of this instance where they help, a glyph elsewhere. */
function Illustration({ step, agents }: { step: number; agents: Agent[] }) {
  const t = useT();
  const crowd = step === 0 || step === 2;
  const pair = step === 6 ? [agents.find((a) => a.origin === "demo"), agents.find((a) => a.origin === "connected")] : [];
  return (
    <div aria-hidden className="relative flex h-28 items-end justify-center gap-6 overflow-hidden border-y border-border bg-[radial-gradient(closest-side_at_50%_70%,rgb(56_68_58/0.55),transparent)] pb-5">
      {crowd && agents.length ? (
        <span className="flex items-end gap-3">{agents.slice(0, 6).map((a) => <AgentFigure key={a.id} id={a.id} scale={3} crop />)}</span>
      ) : step === 6 ? (
        pair.map((a, i) => (
          <span key={i} className="flex flex-col items-center gap-2">
            {a ? <AgentFigure id={a.id} scale={3} crop /> : <span className="h-[42px] w-6 border border-dashed border-sage/50" />}
            <span className={cn("rounded-[3px] border px-1.5 font-mono text-meta", i ? "border-sage/40 text-sage" : "border-border text-faint")}>{i ? t.origin.connected : t.origin.simulated}</span>
          </span>
        ))
      ) : (
        <Glyph name={GLYPH[step]} cell={5} className="mb-1 text-muted-foreground" />
      )}
    </div>
  );
}

/**
 * A short, optional first-visit introduction to Tend, AI agents and the world. It can be skipped at any point and
 * restarted from the help button or the navigation; finishing it can hand over to the live tour of the world.
 */
export function Welcome() {
  const t = useT();
  const ready = useStore((s) => s.ready);
  const done = useStore((s) => s.prefs.welcomeDone);
  const setPrefs = useStore((s) => s.setPrefs);
  const agents = useStore((s) => s.agents);
  const [step, setStep] = useState(0);
  const open = ready && !done;
  // Restarting the introduction starts it from the beginning; closing leaves the last step in place while it fades.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setStep(0);
  }
  const steps = t.welcome.steps;
  const s = steps[step];
  const last = step === steps.length - 1;
  const close = (tour: boolean) => setPrefs({ welcomeDone: true, introDone: !tour });
  const go = (d: number) => setStep((i) => Math.max(0, Math.min(steps.length - 1, i + d)));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close(false)}>
      <DialogContent showCloseButton={false} aria-roledescription={t.welcome.label}
        className="gap-0 overflow-hidden rounded-[10px] border border-border bg-background p-0 shadow-[0_32px_80px_-24px_rgb(0_0_0/0.95)] ring-0 sm:max-w-[480px]"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(1);
          if (e.key === "ArrowLeft") go(-1);
        }}>
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <LanguageSwitch />
          <button type="button" onClick={() => close(false)} className="-mr-1.5 rounded-[4px] px-1.5 py-1 text-caption text-faint transition-colors hover:text-foreground">{t.welcome.skip}</button>
        </div>
        <Illustration step={step} agents={agents} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.22, ease: EASE }} className="min-h-[13.5rem] px-6 pt-5 sm:min-h-[12rem]">
            <p className="eyebrow">{s.eyebrow}</p>
            <DialogTitle className="mt-2 text-h2 leading-snug text-balance">{s.title}</DialogTitle>
            <DialogDescription className="mt-2.5 text-body leading-relaxed text-pretty text-muted-foreground">{s.body}</DialogDescription>
          </motion.div>
        </AnimatePresence>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-2 pb-5">
          <span className="flex gap-1">
            {steps.map((_, i) => (
              <button key={i} type="button" onClick={() => setStep(i)} aria-label={t.welcome.progress(i + 1, steps.length)} aria-current={i === step ? "step" : undefined}
                className="grid h-6 w-4 place-items-center">
                <span className={cn("h-1 w-3 transition-colors duration-300", i <= step ? "bg-sage" : "bg-border")} />
              </button>
            ))}
          </span>
          <span className="ml-auto flex flex-wrap justify-end gap-2">
            {step > 0 && !last && <Button variant="ghost" onClick={() => go(-1)} className="text-muted-foreground">{t.welcome.back}</Button>}
            {last ? (
              <>
                <Button variant="ghost" onClick={() => close(false)} className="text-muted-foreground">{t.welcome.explore}</Button>
                <Button onClick={() => close(true)}>{t.welcome.tour} <ArrowRightIcon /></Button>
              </>
            ) : (
              <Button onClick={() => go(1)} autoFocus>{t.welcome.next} <ArrowRightIcon /></Button>
            )}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
