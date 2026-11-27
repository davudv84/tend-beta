"use client";

import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { useRef, type ReactNode } from "react";
import { cx } from "../cx";
import { useReducedMotionPref } from "../scope";

/**
 * Section Stack: full-height sections pin to the top and the next one slides over the last. The covered section recedes (a
 * touch smaller, dimmer) so the change of subject feels like turning a page, not scrolling past one. For the big handovers on
 * a homepage. Here it runs inside a small scroll window so it can be tried in place; on a page, drop `scroller` and it follows
 * the window.
 */
export function SectionStack({ sections, className }: { sections: { id: string; content: ReactNode }[]; className?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ container: scroller });
  const reduced = useReducedMotionPref();
  const n = sections.length;
  return (
    <div
      ref={scroller}
      tabIndex={0}
      role="region"
      aria-label="Section stack demonstration. Scroll inside to try it."
      className={cx("t-scroll relative h-[22rem] overflow-y-auto rounded-t-lg border border-t-line bg-t-sunken", className)}
    >
      <div style={{ height: `${n * 100}%` }}>
        {sections.map((s, i) => (
          <StackSection key={s.id} index={i} count={n} progress={scrollYProgress} reduced={reduced}>
            {s.content}
          </StackSection>
        ))}
      </div>
    </div>
  );
}

function StackSection({ index, count, progress, reduced, children }: { index: number; count: number; progress: MotionValue<number>; reduced: boolean; children: ReactNode }) {
  // Section i recedes while section i+1 travels over it: that happens between (i+1)/count and (i+2)/count of the scroll.
  const start = index / count;
  const end = (index + 1) / count;
  const scale = useTransform(progress, [start, end], [1, reduced ? 1 : 0.94]);
  const shade = useTransform(progress, [start, end], [0, reduced ? 0 : 0.5]);
  const isLast = index === count - 1;
  return (
    <div className="sticky top-0 h-[22rem]" style={{ height: `${100 / count}%`, minHeight: "22rem", zIndex: index + 1 }}>
      <motion.div style={{ scale: isLast ? 1 : scale }} className="relative h-full origin-top overflow-hidden border-t border-t-line bg-t-surface first:border-t-0 shadow-[0_-12px_24px_-16px_rgb(0_0_0/0.25)]">
        {children}
        {!isLast && <motion.div aria-hidden style={{ opacity: shade }} className="pointer-events-none absolute inset-0 bg-t-canvas" />}
      </motion.div>
    </div>
  );
}
