"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "../cx";
import { useReducedMotionPref } from "../scope";
import { IconButton } from "../ui/button";
import { duration, ease, spring } from "./tokens";

/**
 * Image Handoff: a visual passes from a small context to a large one without ever disappearing. The thumbnail is the same
 * element as the detail view, so the eye follows one object instead of reading two. For moving between related product
 * visuals: a row in the activity list becomes the full request.
 */
export function ImageHandoff({
  items,
  className,
}: {
  items: { id: string; title: string; thumb: ReactNode; detail: ReactNode }[];
  className?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const reduced = useReducedMotionPref();
  const current = items.find((i) => i.id === open);
  const t = reduced ? { duration: 0.14 } : spring.settle;
  return (
    <LayoutGroup>
      <div className={cx("relative min-h-[17rem]", className)}>
        <ul className={cx("grid gap-3 sm:grid-cols-3", open && "pointer-events-none")}>
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => setOpen(it.id)}
                className="group block w-full text-left"
              >
                {open === it.id ? (
                  <div className="aspect-[4/3] rounded-t-lg border border-dashed border-t-line-strong" />
                ) : (
                  <motion.div
                    layoutId={`handoff-${it.id}`}
                    transition={t}
                    className="aspect-[4/3] overflow-hidden rounded-t-lg border border-t-line bg-t-surface shadow-t-1 transition-[border-color] duration-(--t-dur-fast) group-hover:border-t-line-strong"
                  >
                    <div aria-hidden className="origin-top-left scale-[0.62] p-3 sm:scale-[0.7]" style={{ width: "145%" }}>
                      {it.thumb}
                    </div>
                  </motion.div>
                )}
                <p className="mt-2 text-t-small text-t-text">{it.title}</p>
              </button>
            </li>
          ))}
        </ul>
        <AnimatePresence>
          {current && (
            <motion.div
              key="layer"
              className="absolute inset-0 z-10 flex"
              initial={{ opacity: 1 }}
              exit={{ opacity: 1, transition: { duration: duration.slow } }}
            >
              <motion.div
                aria-hidden
                className="absolute -inset-2 rounded-t-xl bg-t-canvas/80 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: duration.base, ease: ease.out } }}
                exit={{ opacity: 0, transition: { duration: duration.base, ease: ease.in } }}
                onClick={() => setOpen(null)}
              />
              <motion.div
                layoutId={`handoff-${current.id}`}
                transition={t}
                role="dialog"
                aria-label={current.title}
                className="relative m-auto w-full max-w-lg overflow-hidden rounded-t-lg border border-t-line bg-t-surface shadow-t-3"
              >
                <div className="flex items-center justify-between border-b border-t-line py-2 pr-2 pl-5">
                  <p className="text-t-label text-t-ink">{current.title}</p>
                  <IconButton icon={X} label="Close" size="sm" onClick={() => setOpen(null)} />
                </div>
                <div className="p-5">{current.detail}</div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}
