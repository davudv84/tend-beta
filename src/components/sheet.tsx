"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { animate, motion, useDragControls, useMotionValue, useReducedMotion } from "framer-motion";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

const EASE = [0.2, 0, 0, 1] as const;

export function useViewportHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    const read = () => setH(window.visualViewport?.height ?? window.innerHeight);
    read();
    window.visualViewport?.addEventListener("resize", read);
    addEventListener("resize", read);
    return () => {
      window.visualViewport?.removeEventListener("resize", read);
      removeEventListener("resize", read);
    };
  }, []);
  return h;
}

/**
 * A bottom sheet dragged by its handle, so its content scrolls normally.
 * `snaps` are visible heights as fractions of the space above `bottom` (or px when > 1), lowest first.
 * Modal sheets close when flung below their lowest snap; resting sheets stay docked at it.
 */
export function BottomSheet({
  open = true, onClose, snaps = [0.62], snap, onSnap, modal = false, bottom = 0, top = 56, title, header, children, className, label,
}: {
  open?: boolean;
  onClose?: () => void;
  snaps?: number[];
  snap?: number;
  onSnap?: (i: number) => void;
  modal?: boolean;
  /** Space kept clear below the sheet, e.g. for the navigation dock. */
  bottom?: number;
  /** Space kept clear above the sheet when fully open. */
  top?: number;
  title?: string;
  /** Always-visible row under the handle; tapping it toggles between the lowest and next snap. */
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const t = useT();
  const vh = useViewportHeight();
  const reduce = useReducedMotion();
  const controls = useDragControls();
  const id = useId();
  const avail = Math.max(0, vh - bottom - top);
  const heights = snaps.map((s) => Math.round(Math.min(avail, s > 1 ? s : s * avail)));
  const max = heights[heights.length - 1] ?? 0;
  const [own, setOwn] = useState(0);
  const index = Math.min(snap ?? own, heights.length - 1);
  const setIndex = (i: number) => (onSnap ? onSnap(i) : setOwn(i));
  const y = useMotionValue(max);
  const shown = open && vh > 0;
  const panel = useRef<HTMLDivElement>(null);

  // Settle on the current snap (or off-screen when closed). The first placement, once the viewport is measured,
  // happens before paint and without animation, so a closed sheet never flashes open while the page loads.
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (!vh) return;
    const target = shown ? max - heights[index] : max + bottom + 24;
    if (!placed.current) {
      placed.current = true;
      y.set(target);
      return;
    }
    const a = animate(y, target, reduce ? { duration: 0 } : { duration: 0.42, ease: EASE });
    return () => a.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, index, max, vh, reduce]);

  useEffect(() => {
    if (!modal || !open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
    addEventListener("keydown", onKey);
    panel.current?.querySelector<HTMLElement>("a, button, [tabindex]")?.focus({ preventScroll: true });
    return () => removeEventListener("keydown", onKey);
  }, [modal, open, onClose]);

  const settle = (_: unknown, info: { velocity: { y: number } }) => {
    const projected = y.get() + info.velocity.y * 0.18;
    const visible = max - projected;
    if (modal && visible < heights[0] * 0.55) return onClose?.();
    let best = 0;
    heights.forEach((h, i) => Math.abs(h - visible) < Math.abs(heights[best] - visible) && (best = i));
    if (best === index) animate(y, max - heights[best], { duration: 0.3, ease: EASE });
    setIndex(best);
  };

  const toggle = () => setIndex(index === 0 ? Math.min(1, heights.length - 1) : 0);

  return (
    <>
      {modal && (
        <motion.div
          aria-hidden
          className={cn("fixed inset-0 z-[70] bg-black/50", !open && "pointer-events-none")}
          initial={false}
          animate={{ opacity: open ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.25 }}
          onClick={onClose}
        />
      )}
      <motion.div
        ref={panel}
        role={modal ? "dialog" : "region"}
        aria-modal={modal || undefined}
        aria-labelledby={title ? id : undefined}
        aria-label={!title ? label : undefined}
        aria-hidden={!shown || undefined}
        inert={!shown || undefined}
        drag="y"
        dragListener={false}
        dragControls={controls}
        dragConstraints={{ top: 0, bottom: modal ? max + bottom : max - heights[0] }}
        dragElastic={{ top: 0.04, bottom: 0.2 }}
        dragMomentum={false}
        onDragEnd={settle}
        style={{ y, height: max, bottom }}
        className={cn(
          modal ? "z-[70]" : "z-40",
          "fixed inset-x-0 mx-auto flex max-w-[640px] flex-col rounded-t-[10px] border border-b-0 border-border bg-surface shadow-[0_-24px_48px_-28px_rgb(0_0_0/0.9)]",
          className,
        )}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2 active:cursor-grabbing"
          onPointerDown={(e) => controls.start(e)}
        >
          <button type="button" onClick={toggle} aria-label={index === 0 ? t.common.expand : t.common.collapse} className="flex h-5 w-16 items-start justify-center">
            <span className="h-1 w-9 rounded-full bg-border transition-colors hover:bg-faint" />
          </button>
          {(header || title) && (
            <div className="w-full px-4 pb-3" onClick={(e) => header && !(e.target as HTMLElement).closest("a, button, input, textarea") && toggle()}>
              {title && <h2 id={id} className="text-title">{title}</h2>}
              {header}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(16px,env(safe-area-inset-bottom))]">{children}</div>
      </motion.div>
    </>
  );
}
