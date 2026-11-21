"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef, type ReactNode } from "react";
import { cx } from "../cx";
import { useReducedMotionPref } from "../scope";
import { Reveal } from "./reveal";

/**
 * Alternating Timeline: steps hang off a centre line, left then right. The line draws as you read, so progress is something
 * you can see. For "how TEND works". On narrow screens it collapses to one column on the left.
 */
export function AlternatingTimeline({
  steps,
  className,
}: {
  steps: { id: string; step: string; title: string; body: ReactNode; aside?: ReactNode }[];
  className?: string;
}) {
  const ref = useRef<HTMLOListElement>(null);
  const reduced = useReducedMotionPref();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 70%", "end 60%"] });
  const grow = useTransform(scrollYProgress, [0, 1], [0, 1]);
  return (
    <ol ref={ref} className={cx("relative flex flex-col gap-12 md:gap-16", className)}>
      <span aria-hidden className="absolute top-2 bottom-2 left-[11px] w-px bg-t-line md:left-1/2" />
      <motion.span
        aria-hidden
        style={{ scaleY: reduced ? 1 : grow }}
        className="absolute top-2 bottom-2 left-[11px] w-px origin-top bg-t-accent md:left-1/2"
      />
      {steps.map((s, i) => {
        const right = i % 2 === 1;
        return (
          <li key={s.id} className="relative grid grid-cols-[minmax(0,1fr)] items-start gap-x-16 pl-10 md:grid-cols-2 md:pl-0">
            <span aria-hidden className="absolute top-1.5 left-0 size-[23px] rounded-full border border-t-line-strong bg-t-canvas md:left-1/2 md:-translate-x-1/2">
              <span className="absolute inset-[6px] rounded-[2px] bg-t-accent" />
            </span>
            <Reveal className={cx("flex flex-col gap-2", right ? "md:col-start-2" : "md:col-start-1 md:items-end md:text-right")}>
              <p className="t-num text-t-caption text-t-accent-text">{s.step}</p>
              <h3 className="text-t-h3 text-t-ink">{s.title}</h3>
              <div className="max-w-md text-t-small text-t-muted">{s.body}</div>
            </Reveal>
            {s.aside && (
              <Reveal delay={0.08} className={cx("mt-4 md:mt-0", right ? "md:col-start-1 md:row-start-1 md:justify-self-end" : "md:col-start-2")}>
                {s.aside}
              </Reveal>
            )}
          </li>
        );
      })}
    </ol>
  );
}
