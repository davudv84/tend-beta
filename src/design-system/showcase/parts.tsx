"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cx } from "../cx";
import { Reveal } from "../motion/reveal";
import { useScope } from "../scope";
import { Icon } from "../ui/icons";

/** A numbered, anchored chapter of the showcase. Open on the canvas: no box, just a hairline and generous type. */
export function Chapter({ id, n, title, lead, children }: { id: string; n: string; title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-t border-t-line py-20 first:border-t-0 md:py-28">
      <Reveal className="mb-14 flex max-w-3xl flex-col gap-5 md:mb-20">
        <p className="t-num flex items-center gap-3 text-t-label text-t-muted">
          <span>{n}</span>
          <span aria-hidden className="h-px w-8 bg-t-line-strong" />
        </p>
        <h2 id={`${id}-h`} className="text-t-h1 text-t-ink [text-wrap:balance]">
          {title}
        </h2>
        <p className="text-t-lead text-t-muted [text-wrap:pretty]">{lead}</p>
      </Reveal>
      <div className="flex flex-col gap-20 md:gap-24">{children}</div>
    </section>
  );
}

/** A named group inside a chapter. */
export function Sub({ title, note, children, className }: { title: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex max-w-2xl flex-col gap-1.5">
        <h3 className="text-t-h3 text-t-ink">{title}</h3>
        {note && <p className="text-t-small text-t-muted [text-wrap:pretty]">{note}</p>}
      </div>
      {children}
    </div>
  );
}

/** The surface a component is shown on: soft, one hairline, a caption underneath. Not a card. */
export function Plate({
  children,
  caption,
  className,
  bodyClassName,
  bare,
}: {
  children: ReactNode;
  caption?: ReactNode;
  className?: string;
  bodyClassName?: string;
  bare?: boolean;
}) {
  return (
    <figure className={cx("flex min-w-0 flex-col gap-2.5", className)}>
      <div className={cx("rounded-t-lg border border-t-line", bare ? "" : "bg-t-surface p-6 md:p-8", bodyClassName)}>{children}</div>
      {caption && <figcaption className="text-t-caption text-t-muted">{caption}</figcaption>}
    </figure>
  );
}

/** Small label above a state in a row of states. */
export function Cap({ children }: { children: ReactNode }) {
  return <p className="mb-2.5 text-t-caption text-t-muted">{children}</p>;
}

/** Marks content that is illustrative, not real functionality or data. */
export function SampleTag({ children = "Sample data" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-t-xs border border-dashed border-t-line-strong px-1.5 text-[0.75rem] leading-none text-t-muted">
      {children}
    </span>
  );
}

/** Click to copy a token name or value. Confirms in place. */
export function CopyChip({ value, children, className }: { value: string; children?: ReactNode; className?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          return;
        }
        setDone(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1400);
      }}
      aria-label={`Copy ${value}`}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-t-xs font-t-mono text-[0.75rem] leading-5 text-t-muted transition-colors duration-(--t-dur-fast) hover:text-t-ink",
        className,
      )}
    >
      {done ? <Icon icon={Check} size="xs" className="text-t-ok" /> : null}
      {done ? "Copied" : (children ?? value)}
    </button>
  );
}

/** Reads a token's resolved value from the nearest scope, and follows the theme when it changes. */
export function useToken(name: string): string {
  const { container } = useScope();
  // Read straight from the DOM on every render: a theme change re-renders through the scope, so this stays current.
  return useSyncExternalStore(
    () => () => {},
    () => (container ? getComputedStyle(container).getPropertyValue(name).trim() : ""),
    () => "",
  );
}

/** A definition list for metadata: label on the left, value on the right. */
export function Facts({ items, className }: { items: [string, ReactNode][]; className?: string }) {
  return (
    <dl className={cx("grid grid-cols-[auto_1fr] gap-x-8 gap-y-2.5 text-t-small", className)}>
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-t-muted">{k}</dt>
          <dd className="text-t-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
