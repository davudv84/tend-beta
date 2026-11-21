"use client";

import { motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "../cx";
import { useReducedMotionPref } from "../scope";
import { IconButton } from "../ui/button";
import { distance, transition } from "./tokens";

/**
 * Depth Stack: panels sit one behind another; the one in front is the subject. Moving forward lifts the front panel away and
 * brings the next one up. Each layer behind is a little smaller, a little higher and a little quieter, which reads as depth
 * without perspective tricks. For cinematic product storytelling: a request, the policy that met it, the decision.
 *
 * Original implementation. Motion principles are informed by the references; no third-party animation code is used.
 */
export function DepthStack({ panels, className }: { panels: { id: string; label: string; content: ReactNode }[]; className?: string }) {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotionPref();
  const n = panels.length;
  return (
    <div className={cx("flex flex-col gap-5", className)}>
      <div className="relative h-[14rem] sm:h-[12.5rem]" role="group" aria-roledescription="stack" aria-label="Request flow">
        {panels.map((p, i) => {
          const depth = (i - active + n) % n; // 0 is in front
          const hidden = depth > 3;
          return (
            <motion.div
              key={p.id}
              aria-hidden={depth !== 0}
              inert={depth !== 0}
              className="absolute inset-x-0 top-0 origin-top overflow-hidden rounded-t-lg border border-t-line bg-t-surface shadow-t-2"
              style={{ zIndex: n - depth }}
              initial={false}
              animate={{
                y: reduced ? 0 : depth * -distance.sm * 2.4,
                scale: reduced ? 1 : 1 - depth * 0.045,
                opacity: hidden ? 0 : reduced ? (depth === 0 ? 1 : 0) : 1 - depth * 0.28,
              }}
              transition={reduced ? { duration: 0.14 } : transition.stack}
            >
              <div className="p-6">{p.content}</div>
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-t-canvas"
                initial={false}
                animate={{ opacity: depth === 0 ? 0 : 0.35 + depth * 0.1 }}
                transition={reduced ? { duration: 0.14 } : transition.stack}
              />
            </motion.div>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <ol className="flex items-center gap-1.5" aria-label="Steps">
          {panels.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-current={i === active}
                className={cx(
                  "h-8 rounded-t-md px-3 text-t-label transition-colors duration-(--t-dur-fast) ease-t-out",
                  i === active ? "bg-t-sunken text-t-ink" : "text-t-muted hover:text-t-ink",
                )}
              >
                {p.label}
              </button>
            </li>
          ))}
        </ol>
        <div className="flex gap-1">
          <IconButton icon={ChevronLeft} label="Previous" variant="secondary" size="sm" onClick={() => setActive((a) => (a - 1 + n) % n)} />
          <IconButton icon={ChevronRight} label="Next" variant="secondary" size="sm" onClick={() => setActive((a) => (a + 1) % n)} />
        </div>
      </div>
    </div>
  );
}
