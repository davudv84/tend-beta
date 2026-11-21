"use client";

import { AnimatePresence, motion } from "framer-motion";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleCheck, CircleX, Info, TriangleAlert, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cx } from "../cx";
import { useReducedMotionPref } from "../scope";
import { distance, duration, ease } from "../motion/tokens";
import { Icon } from "./icons";

export type Tone = "neutral" | "info" | "ok" | "warn" | "danger";

export const TONE: Record<Tone, { icon: LucideIcon; soft: string; ink: string; solid: string; line: string; border: string }> = {
  neutral: { icon: Info, soft: "bg-t-sunken", ink: "text-t-text", solid: "text-t-muted", line: "border-t-line", border: "border-t-line" },
  info: { icon: Info, soft: "bg-t-info-soft", ink: "text-t-info-ink", solid: "text-t-info", line: "border-t-info-line", border: "border-t-info-line" },
  ok: { icon: CircleCheck, soft: "bg-t-ok-soft", ink: "text-t-ok-ink", solid: "text-t-ok", line: "border-t-ok-line", border: "border-t-ok-line" },
  warn: { icon: TriangleAlert, soft: "bg-t-warn-soft", ink: "text-t-warn-ink", solid: "text-t-warn", line: "border-t-warn-line", border: "border-t-warn-line" },
  danger: { icon: CircleX, soft: "bg-t-danger-soft", ink: "text-t-danger-ink", solid: "text-t-danger", line: "border-t-danger-line", border: "border-t-danger-line" },
};

/* ---------------------------------------------------------------- Alert */

export function Alert({
  tone = "info",
  title,
  children,
  action,
  onDismiss,
  className,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex gap-3 rounded-t-lg border p-4", t.soft, t.border, className)}>
      <Icon icon={t.icon} size="lg" className={cx("mt-px shrink-0", t.solid)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={cx("text-t-label", t.ink)}>{title}</p>
        {children && <div className={cx("text-t-small", t.ink, "opacity-90")}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className={cx("-m-1 grid size-7 shrink-0 place-items-center rounded-t-sm transition-colors duration-(--t-dur-fast) hover:bg-black/5", t.ink)}
        >
          <Icon icon={X} size="md" />
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Toast */

interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}
const ToastCtx = createContext<{ toast: (t: Omit<ToastItem, "id">) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast needs a ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((x) => x.id !== id)), []);
  const toast = useCallback((t: Omit<ToastItem, "id">) => setItems((l) => [...l.slice(-2), { ...t, id: next.current++ }]), []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div aria-live="polite" aria-label="Notifications" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 sm:right-6 sm:bottom-6">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <ToastView key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const reduced = useReducedMotionPref();
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = setTimeout(onDismiss, 5200);
    return () => clearTimeout(id);
  }, [paused, onDismiss]);
  const t = TONE[item.tone];
  return (
    <motion.div
      layout={!reduced}
      initial={{ opacity: 0, y: reduced ? 0 : distance.md }}
      animate={{ opacity: 1, y: 0, transition: { duration: duration.slow, ease: ease.out } }}
      exit={{ opacity: 0, x: reduced ? 0 : distance.lg, transition: { duration: duration.base, ease: ease.in } }}
      onHoverStart={() => setPaused(true)}
      onHoverEnd={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      role="status"
      className="pointer-events-auto flex items-start gap-3 rounded-t-lg border border-t-line bg-t-raised p-3.5 shadow-t-2"
    >
      <Icon icon={t.icon} size="lg" className={cx("mt-px", t.solid)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-t-label text-t-ink">{item.title}</p>
        {item.description && <p className="text-t-small text-t-muted">{item.description}</p>}
        {item.action && (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              onDismiss();
            }}
            className="mt-1.5 self-start rounded-t-xs text-t-label text-t-accent-text underline-offset-4 hover:underline"
          >
            {item.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
        className="-m-1 grid size-7 shrink-0 place-items-center rounded-t-sm text-t-muted transition-colors duration-(--t-dur-fast) hover:bg-t-sunken hover:text-t-ink"
      >
        <Icon icon={X} size="md" />
      </button>
    </motion.div>
  );
}

/* ---------------------------------------------------------------- Empty state / Skeleton */

export function EmptyState({ icon, title, children, action, className }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center gap-4 px-6 py-12 text-center", className)}>
      <div className="relative grid size-12 place-items-center rounded-t-lg border border-t-line-strong bg-t-surface text-t-muted shadow-t-1">
        <Icon icon={icon} size="lg" />
        <span aria-hidden className="absolute -top-px -right-px size-2 translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-t-accent" />
      </div>
      <div className="flex max-w-sm flex-col gap-1.5">
        <h3 className="text-t-h4 text-t-ink">{title}</h3>
        {children && <p className="text-t-small text-t-muted">{children}</p>}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("t-pulse rounded-t-sm bg-t-line", className)} />;
}
