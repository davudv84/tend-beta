"use client";

import { Fragment, useState, type HTMLAttributes, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cx } from "../cx";
import { Icon } from "./icons";
import { TONE, type Tone } from "./feedback";

/* ---------------------------------------------------------------- Status badge */

/** A status is always a word. The colour reinforces it; it is never the only signal. */
export function StatusBadge({ tone = "neutral", children, dot = true, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  const t = TONE[tone];
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-t-sm border px-2 text-t-caption font-medium whitespace-nowrap", t.soft, t.ink, t.border, className)}>
      {dot && <span aria-hidden className={cx("size-1.5 rounded-full bg-current", t.solid)} />}
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- Table */

export function Table({ children, className, compact }: { children: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cx("t-scroll w-full overflow-x-auto", className)}>
      <table className={cx("w-full border-collapse text-left text-t-small", compact ? "[&_td]:py-2 [&_th]:py-2" : "[&_td]:py-3.5 [&_th]:py-2.5")}>{children}</table>
    </div>
  );
}
export const THead = ({ children }: { children: ReactNode }) => <thead className="border-b border-t-line">{children}</thead>;
export const TBody = ({ children }: { children: ReactNode }) => <tbody className="divide-y divide-t-line">{children}</tbody>;
export function Tr({ selected, interactive = true, className, ...props }: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; interactive?: boolean }) {
  return (
    <tr
      data-selected={selected || undefined}
      className={cx("transition-colors duration-(--t-dur-fast) ease-t-out data-[selected]:bg-t-accent-soft", interactive && "hover:bg-t-sunken/60 data-[selected]:hover:bg-t-accent-soft", className)}
      {...props}
    />
  );
}
export const Th = ({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th scope="col" className={cx("px-3 text-t-caption font-medium whitespace-nowrap text-t-muted first:pl-0 last:pr-0", className)} {...props} />
);
export const Td = ({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cx("px-3 align-middle text-t-text first:pl-0 last:pr-0", className)} {...props} />
);

/* ---------------------------------------------------------------- Activity row */

/** One line of history: who did what, and when. The icon names the kind of action. */
export function ActivityRow({
  icon,
  title,
  meta,
  time,
  trailing,
  onClick,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  meta?: ReactNode;
  time: string;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cx(
        "group flex min-h-[var(--t-row-h)] w-full items-center gap-3 rounded-t-md px-2 py-2 text-left",
        onClick && "transition-colors duration-(--t-dur-fast) ease-t-out hover:bg-t-sunken/70",
        className,
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-t-md bg-t-sunken text-t-muted">
        <Icon icon={icon} size="md" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-t-small text-t-ink">{title}</span>
        {meta && <span className="truncate text-t-caption text-t-muted">{meta}</span>}
      </span>
      {trailing}
      <time className="t-num shrink-0 text-t-caption text-t-muted">{time}</time>
      {onClick && <Icon icon={ChevronRight} size="sm" className="text-t-subtle opacity-0 transition-opacity duration-(--t-dur-fast) group-hover:opacity-100" />}
    </Tag>
  );
}

/* ---------------------------------------------------------------- Code block */

type Lang = "json" | "shell" | "plain";
const TOKENS: Record<Exclude<Lang, "plain">, RegExp> = {
  json: /("(?:\\.|[^"\\])*")(\s*:)?|(\b-?\d+(?:\.\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)|([{}[\],])/g,
  shell: /(#.*$)|("(?:\\.|[^"\\])*"|'[^']*')|(\s--?[a-zA-Z][\w-]*)|(\$\w+)/gm,
};

function highlight(code: string, lang: Lang): ReactNode[] {
  if (lang === "plain") return [code];
  const out: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(TOKENS[lang].source, TOKENS[lang].flags);
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m.index > last) out.push(code.slice(last, m.index));
    let color = "var(--t-code-punct)";
    if (lang === "json") color = m[1] ? (m[2] ? "var(--t-code-key)" : "var(--t-code-string)") : m[3] || m[4] ? "var(--t-code-number)" : "var(--t-code-punct)";
    else color = m[1] ? "var(--t-code-comment)" : m[2] ? "var(--t-code-string)" : m[3] ? "var(--t-code-key)" : "var(--t-code-number)";
    out.push(
      <span key={m.index} style={{ color }}>
        {lang === "json" && m[1] && m[2] ? (
          <>
            {m[1]}
            <span style={{ color: "var(--t-code-punct)" }}>{m[2]}</span>
          </>
        ) : (
          m[0]
        )}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function CodeBlock({ code, lang = "plain", title, className }: { code: string; lang?: Lang; title?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* clipboard can be blocked; the visual confirmation still tells the truth about the click, so only show it on success */
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <figure className={cx("overflow-hidden rounded-t-lg border border-t-line bg-t-code-bg", className)}>
      <figcaption className="flex h-10 items-center justify-between border-b border-t-line px-4">
        <span className="text-t-caption text-t-muted">{title ?? lang}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
          className="-mr-2 flex h-7 items-center gap-1.5 rounded-t-sm px-2 text-t-caption text-t-muted transition-colors duration-(--t-dur-fast) ease-t-out hover:bg-t-sunken hover:text-t-ink"
        >
          <Icon icon={copied ? Check : Copy} size="sm" className={copied ? "text-t-ok" : undefined} />
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </figcaption>
      <pre className="t-scroll overflow-x-auto p-4 font-t-mono text-t-code text-t-text">
        <code>{highlight(code, lang)}</code>
      </pre>
    </figure>
  );
}

/* ---------------------------------------------------------------- Event timeline */

export interface TimelineEvent {
  id: string;
  title: ReactNode;
  detail?: ReactNode;
  time: string;
  tone?: Tone;
  icon?: LucideIcon;
}

/** A vertical record of what happened, newest first. The node colour repeats the outcome's word; it never replaces it. */
export function EventTimeline({ events, className }: { events: TimelineEvent[]; className?: string }) {
  return (
    <ol className={cx("relative flex flex-col", className)}>
      {events.map((e, i) => {
        const t = TONE[e.tone ?? "neutral"];
        const last = i === events.length - 1;
        return (
          <Fragment key={e.id}>
            <li className="relative grid grid-cols-[28px_1fr_auto] gap-x-3 pb-5 last:pb-0">
              {!last && <span aria-hidden className="absolute top-7 bottom-0 left-[13.5px] w-px bg-t-line" />}
              <span className={cx("relative z-10 mt-0.5 grid size-7 place-items-center rounded-full border bg-t-canvas", t.border, t.solid)}>
                <Icon icon={e.icon ?? t.icon} size="sm" />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5 pt-1">
                <p className="text-t-small text-t-ink">{e.title}</p>
                {e.detail && <p className="text-t-caption text-t-muted">{e.detail}</p>}
              </div>
              <time className="t-num pt-1.5 text-t-caption text-t-muted">{e.time}</time>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
