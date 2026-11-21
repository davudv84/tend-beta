"use client";

import { motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { cx } from "../cx";
import { useReducedMotionPref } from "../scope";
import { spring } from "./tokens";

/**
 * Morph Gap: an editorial effect for one headline. The space between two phrases opens, and the TEND square, the same one
 * that passes through the mark's frame, slides across it. The line reads as two ideas joined by a decision. Use once per page,
 * on the sentence that carries the brand.
 *
 * The gap is real layout (its width animates), so the text reflows with it; under reduced motion it simply sits open.
 */
export function MorphGap({
  before,
  after,
  className,
  open: controlled,
}: {
  before: ReactNode;
  after: ReactNode;
  className?: string;
  open?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const reduced = useReducedMotionPref();
  const open = reduced ? true : (controlled ?? hover);
  return (
    <h3
      className={cx("flex flex-wrap items-baseline text-t-h1 text-t-ink sm:text-t-hero", className)}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      tabIndex={0}
    >
      <motion.span layout={!reduced} transition={spring.settle}>{before}</motion.span>
      <motion.span
        aria-hidden
        className="relative mx-[0.12em] inline-block h-[0.62em] self-center overflow-hidden"
        initial={false}
        animate={{ width: open ? "1.9em" : "0.28em" }}
        transition={reduced ? { duration: 0 } : spring.settle}
      >
        <span className="absolute top-1/2 right-0 left-0 h-px -translate-y-1/2 bg-t-line-strong" />
        <motion.span
          className="absolute top-1/2 left-0 size-[0.26em] -translate-y-1/2 rounded-[0.04em] bg-t-accent"
          initial={false}
          animate={{ x: open ? "calc(1.9em - 0.26em)" : 0, opacity: open ? 1 : 0.6 }}
          transition={reduced ? { duration: 0 } : { ...spring.settle, delay: open ? 0.04 : 0 }}
        />
      </motion.span>
      <motion.span layout={!reduced} transition={spring.settle}>{after}</motion.span>
    </h3>
  );
}
