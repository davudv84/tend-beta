"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { RotateCcwIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { ShotImage, type ShotName } from "../shot";

/**
 * The hero's walkthrough, as sim.ai plays its own workspace: real screenshots of TEND, taken in order while one request went through the
 * real app (scripts/screens/story.json). An agent asks to push code, the request appears on Overview, a person clicks Allow once, TEND
 * confirms, and Activity shows it ran once. It plays once when it comes into view and stops on the last screen; Replay starts it again.
 * Under reduced motion it shows the waiting request and does not move.
 */
type Step = { shot: ShotName; ms: number; cursor?: { x: number; y: number; click?: boolean } };
// Where "Allow once" is, as a share of the window, measured when the screenshot was taken (scripts/screens: boxes.json).
const DESKTOP: Step[] = [
  { shot: "story-1", ms: 1700 },
  { shot: "story-2", ms: 1300 },
  { shot: "story-2", ms: 1100, cursor: { x: 26.5, y: 80 } },
  { shot: "story-2", ms: 450, cursor: { x: 26.5, y: 80, click: true } },
  { shot: "story-3", ms: 2200 },
  { shot: "story-4", ms: 0 },
];
const PHONE: Step[] = [
  { shot: "pstory-1", ms: 1700 },
  { shot: "pstory-2", ms: 1300 },
  { shot: "pstory-2", ms: 1100, cursor: { x: 27.6, y: 54.2 } },
  { shot: "pstory-2", ms: 450, cursor: { x: 27.6, y: 54.2, click: true } },
  { shot: "pstory-3", ms: 0 },
];

// The cursor first appears at the lower right and travels to the button: it waits there on the step before it is needed.
const DESKTOP_STEPS = DESKTOP.map((x, k) => (k === 1 ? { ...x, cursor: { x: 70, y: 96 } } : x));
const PHONE_STEPS = PHONE.map((x, k) => (k === 1 ? { ...x, cursor: { x: 75, y: 92 } } : x));

function usePlayback(steps: Step[], still: number) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [i, setI] = useState(0);
  const reduced = !!useReducedMotion();
  // Start when at least half of it is on screen.
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setSeen(true); }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  useEffect(() => {
    if (!seen || reduced || i >= steps.length - 1) return;
    const id = window.setTimeout(() => setI((n) => n + 1), steps[i].ms);
    return () => clearTimeout(id);
  }, [seen, reduced, i, steps]);
  return { attach: setEl, step: reduced ? still : i, done: !reduced && i === steps.length - 1, replay: () => setI(0) };
}

function Frames({ steps, at, alts, sizes, cover }: { steps: Step[]; at: number; alts: Record<string, string>; sizes: string; cover?: boolean }) {
  const shots = [...new Set(steps.map((s) => s.shot))];
  const cur = steps[at];
  return (
    <>
      {shots.map((name, k) => (
        <div key={name} aria-hidden={name !== cur.shot || undefined} className={cn("transition-opacity duration-500 ease-out", k === 0 ? "relative" : "absolute inset-0", name === cur.shot ? "opacity-100" : "opacity-0")}>
          <ShotImage name={name} alt={alts[name] ?? ""} sizes={sizes} eager={k === 0} cover={cover} />
        </div>
      ))}
      {cur.cursor && (
        <span aria-hidden className="pointer-events-none absolute z-10 transition-[left,top] duration-[900ms] ease-[cubic-bezier(.2,.7,.2,1)]" style={{ left: `${cur.cursor.x}%`, top: `${cur.cursor.y}%` }}>
          <span className={cn("absolute -top-3 -left-3 size-6 rounded-full bg-[#1f6f4f]/30 transition-transform duration-300", cur.cursor.click ? "scale-150 opacity-100" : "scale-0 opacity-0")} />
          <svg viewBox="0 0 24 24" className={cn("relative size-6 drop-shadow-[0_2px_3px_rgb(0_0_0/0.35)] transition-transform duration-150", cur.cursor.click && "scale-90")}>
            <path d="M4 2l15 10.5-6.6 1.4L16 21l-2.9 1.3-3.6-7.2L4 19.5z" fill="#111" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </>
  );
}

/** The desktop walkthrough, in the app's own window. */
export function DesktopStory() {
  const t = useT();
  const s = t.front.shots;
  const { attach, step, done, replay } = usePlayback(DESKTOP_STEPS, 2);
  const steps = DESKTOP_STEPS;
  return (
    <figure ref={attach} aria-label={s.storyLabel} className="relative">
      <div className="relative overflow-hidden rounded-xl border border-white/[0.1] mk-shot shadow-[0_30px_80px_-30px_rgb(0_0_0/0.85)]">
        <Frames steps={steps} at={step} alts={{ "story-1": s.story1, "story-2": s.story2, "story-3": s.story3, "story-4": s.story4 }} sizes="(min-width: 1480px) 1240px, 84vw" />
      </div>
      <Replay show={done} onClick={replay} label={s.replay} />
    </figure>
  );
}

/** The phone walkthrough: the same request, answered on a phone. */
export function PhoneStory() {
  const t = useT();
  const s = t.front.shots;
  const { attach, step, done, replay } = usePlayback(PHONE_STEPS, 2);
  const steps = PHONE_STEPS;
  return (
    <figure ref={attach} aria-label={s.storyLabel} className="relative mx-auto w-[min(76vw,300px)]">
      <div className="relative overflow-hidden rounded-[40px] border-[7px] border-[#1c1c1c] mk-shot shadow-[0_30px_80px_-24px_rgb(0_0_0/0.9)]">
        <span aria-hidden className="absolute top-2 left-1/2 z-10 h-[22px] w-[30%] -translate-x-1/2 rounded-full bg-black" />
        <div className="pt-[26px]">
          <div className="relative">
            <Frames steps={steps} at={step} alts={{ "pstory-1": s.story1, "pstory-2": s.story2, "pstory-3": s.story3 }} sizes="300px" />
          </div>
        </div>
      </div>
      <Replay show={done} onClick={replay} label={s.replay} />
    </figure>
  );
}

function Replay({ show, onClick, label }: { show: boolean; onClick: () => void; label: string }) {
  return (
    <div className="mt-4 flex h-9 justify-center">
      {show && (
        <button type="button" onClick={onClick} className="inline-flex items-center gap-2 rounded-full border border-white/[0.16] bg-black/40 px-4 text-[13px] text-white/85 backdrop-blur outline-none hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-white">
          <RotateCcwIcon className="size-3.5" strokeWidth={2} aria-hidden />{label}
        </button>
      )}
    </div>
  );
}
