"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, Bot, Check, CircleCheck, CircleX, Eye, Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BRAND_ICONS, type BrandSlug } from "@/lib/brand-icons";
import { cx } from "../cx";
import { useReducedMotionPref } from "../scope";
import { distance, duration, ease } from "../motion/tokens";
import { Button } from "../ui/button";
import { Icon } from "../ui/icons";
import { StatusBadge } from "../ui/data";
import type { Tone } from "../ui/feedback";

/* ============================================================================================================
   TEND-specific components. Vocabulary matches the product: an agent asks, a policy decides, a person reviews.
   ============================================================================================================ */

/* ---------------------------------------------------------------- Agent status */

export type AgentState = "active" | "inactive" | "error";
const AGENT_STATE: Record<AgentState, { label: string; dot: string; text: string }> = {
  active: { label: "Active", dot: "bg-t-ok text-t-ok", text: "text-t-ok-ink" },
  inactive: { label: "Inactive", dot: "bg-t-subtle text-t-subtle", text: "text-t-muted" },
  error: { label: "Error", dot: "bg-t-danger text-t-danger", text: "text-t-danger-ink" },
};

/** The one place the system is allowed to breathe: an active agent has a slow, soft halo. Reduced motion: still. */
export function AgentStatus({ state, detail, className }: { state: AgentState; detail?: string; className?: string }) {
  const s = AGENT_STATE[state];
  return (
    <span className={cx("inline-flex items-center gap-2 text-t-small", className)}>
      <span aria-hidden className={cx("relative size-2 rounded-full", s.dot, state === "active" && "t-breathe")} />
      <span className={cx("font-medium", s.text)}>{s.label}</span>
      {detail && <span className="text-t-muted">· {detail}</span>}
    </span>
  );
}

/* ---------------------------------------------------------------- Policy decision */

export type Decision = "allowed" | "denied" | "review";
export const DECISION: Record<Decision, { label: string; icon: LucideIcon; tone: Tone; text: string }> = {
  allowed: { label: "Allowed", icon: CircleCheck, tone: "ok", text: "text-t-ok-ink" },
  denied: { label: "Denied", icon: CircleX, tone: "danger", text: "text-t-danger-ink" },
  review: { label: "Requires review", icon: Eye, tone: "warn", text: "text-t-warn-ink" },
};

/**
 * What TEND decided. Three forms: `inline` for tables and rows (icon and word), `badge` for dense lists, and `block` where the reason
 * matters (an alert-like statement that carries a sentence of why).
 */
export function PolicyDecision({
  decision,
  variant = "inline",
  reason,
  className,
}: {
  decision: Decision;
  variant?: "inline" | "badge" | "block";
  reason?: ReactNode;
  className?: string;
}) {
  const d = DECISION[decision];
  if (variant === "badge") return <StatusBadge tone={d.tone} className={className}>{d.label}</StatusBadge>;
  if (variant === "block")
    return (
      <div className={cx("flex items-start gap-3 border-l-2 py-0.5 pl-4", decision === "allowed" ? "border-t-ok" : decision === "denied" ? "border-t-danger" : "border-t-warn", className)}>
        <div className="flex flex-col gap-0.5">
          <p className={cx("flex items-center gap-2 text-t-label", d.text)}>
            <Icon icon={d.icon} size="md" />
            {d.label}
          </p>
          {reason && <p className="text-t-small text-t-muted">{reason}</p>}
        </div>
      </div>
    );
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-t-small font-medium whitespace-nowrap", d.text, className)}>
      <Icon icon={d.icon} size="md" />
      {d.label}
    </span>
  );
}

/* ---------------------------------------------------------------- Agent avatar */

export function BrandIcon({ slug, className }: { slug: BrandSlug; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label={BRAND_ICONS[slug].title} className={cx("size-4 fill-current", className)}>
      <path d={BRAND_ICONS[slug].path} />
    </svg>
  );
}

/** A small square for an agent: its product's mark when there is an official one, a robot otherwise. */
export function AgentAvatar({ brand, size = 32, className }: { brand?: BrandSlug; size?: 24 | 32 | 40; className?: string }) {
  return (
    <span
      aria-hidden={brand ? undefined : true}
      style={{ width: size, height: size }}
      className={cx("grid shrink-0 place-items-center rounded-t-md border border-t-line bg-t-surface text-t-ink", className)}
    >
      {brand ? <BrandIcon slug={brand} className={size === 24 ? "size-3.5" : "size-[18px]"} /> : <Icon icon={Bot} size={size === 24 ? "sm" : "md"} />}
    </span>
  );
}

/* ---------------------------------------------------------------- Activity event */

export interface ActivityEventData {
  agent: string;
  brand?: BrandSlug;
  action: string;
  resource: string;
  decision: Decision;
  time: string;
}

/** Agent, action, resource, decision, timestamp. Reads left to right on a wide screen and top to bottom on a phone. */
export function ActivityEvent({ event, onOpen, className }: { event: ActivityEventData; onOpen?: () => void; className?: string }) {
  const Tag = onOpen ? "button" : "div";
  return (
    <Tag
      type={onOpen ? "button" : undefined}
      onClick={onOpen}
      className={cx(
        "group grid w-full items-center gap-x-4 gap-y-2 rounded-t-md px-2 py-3 text-left sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_9.5rem_4.5rem]",
        onOpen && "transition-colors duration-(--t-dur-fast) ease-t-out hover:bg-t-sunken/70",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <AgentAvatar brand={event.brand} size={32} />
        <span className="truncate text-t-small font-medium text-t-ink">{event.agent}</span>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <code className="font-t-mono text-t-code text-t-muted">{event.action}</code>
        <span className="truncate font-t-mono text-t-code text-t-ink">{event.resource}</span>
      </span>
      <PolicyDecision decision={event.decision} />
      <time className="t-num text-t-caption text-t-muted sm:text-right">{event.time}</time>
    </Tag>
  );
}

/* ---------------------------------------------------------------- Approval request */

export interface ApprovalData {
  agent: string;
  brand?: BrandSlug;
  verb: string;
  resource: string;
  policy: string;
  why: string;
  requestedBy: string;
  waited: string;
}

type Resolution = null | "approved" | "denied";

/** A person decides on one thing an agent wants to do. Plain sentence first, the exact request second, two clear choices. */
export function ApprovalRequest({ data, className, onResolve }: { data: ApprovalData; className?: string; onResolve?: (r: Exclude<Resolution, null>) => void }) {
  const [state, setState] = useState<Resolution>(null);
  const [busy, setBusy] = useState<Resolution>(null);
  const reduced = useReducedMotionPref();
  const decide = (r: Exclude<Resolution, null>) => {
    setBusy(r);
    setTimeout(() => {
      setState(r);
      setBusy(null);
      onResolve?.(r);
    }, 650);
  };
  return (
    <section aria-label="Approval request" className={cx("overflow-hidden rounded-t-lg border border-t-line bg-t-surface shadow-t-1", className)}>
      <AnimatePresence mode="wait" initial={false}>
        {state === null ? (
          <motion.div
            key="open"
            exit={{ opacity: 0, transition: { duration: duration.fast, ease: ease.in } }}
            className="flex flex-col gap-5 p-[var(--t-pad-panel)]"
          >
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <AgentAvatar brand={data.brand} size={40} />
              <div className="flex min-w-[12rem] flex-1 flex-col gap-0.5">
                <h3 className="text-t-h4 leading-snug text-t-ink">
                  {data.agent} wants to {data.verb}
                </h3>
                <p className="text-t-caption text-t-muted">
                  Waiting {data.waited} · Requested by {data.requestedBy}
                </p>
              </div>
              <StatusBadge tone="warn">Requires review</StatusBadge>
            </div>
            <pre className="t-scroll overflow-x-auto rounded-t-md bg-t-code-bg p-3 font-t-mono text-t-code text-t-ink">
              <code>{data.resource}</code>
            </pre>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-t-small">
              <dt className="text-t-muted">Matched policy</dt>
              <dd className="text-t-ink">{data.policy}</dd>
              <dt className="text-t-muted">Why it paused</dt>
              <dd className="text-t-ink">{data.why}</dd>
            </dl>
            <div className="flex flex-wrap items-center gap-2 border-t border-t-line pt-4">
              <Button variant="primary" leading={Check} loading={busy === "approved"} disabled={busy !== null} onClick={() => decide("approved")}>
                Approve once
              </Button>
              <Button variant="secondary" loading={busy === "denied"} disabled={busy !== null} onClick={() => decide("denied")}>
                Deny
              </Button>
              <span className="ml-auto text-t-caption text-t-muted">Nothing runs until you decide.</span>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: reduced ? 0 : distance.sm }}
            animate={{ opacity: 1, y: 0, transition: { duration: duration.slow, ease: ease.out } }}
            className="flex items-center gap-4 p-[var(--t-pad-panel)]"
          >
            <PolicyDecision decision={state === "approved" ? "allowed" : "denied"} variant="block" className="flex-1"
              reason={state === "approved" ? `${data.agent} ran it once. Future requests will ask again.` : `${data.agent} was told no. Nothing ran.`} />
            <Button variant="ghost" size="sm" leading={Undo2} onClick={() => setState(null)}>
              Reset demo
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* ---------------------------------------------------------------- Policy summary */

export interface PolicySummaryData {
  name: string;
  appliesTo: string;
  updated: string;
  allowed: string[];
  review: string[];
  denied: string[];
}

/** A policy in plain words: three short lists in the order a person thinks about them. */
export function PolicySummary({ data, className }: { data: PolicySummaryData; className?: string }) {
  const groups: { key: Decision; title: string; items: string[] }[] = [
    { key: "allowed", title: "Can do on its own", items: data.allowed },
    { key: "review", title: "Asks a person first", items: data.review },
    { key: "denied", title: "Never allowed", items: data.denied },
  ];
  return (
    <section aria-label={`Policy: ${data.name}`} className={cx("flex flex-col gap-6", className)}>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-t-h3 text-t-ink">{data.name}</h3>
          <p className="text-t-small text-t-muted">
            Applies to {data.appliesTo} · Updated {data.updated}
          </p>
        </div>
        <Button variant="ghost" size="sm" trailing={ArrowUpRight}>
          Edit policy
        </Button>
      </header>
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-3 md:[&>div+div]:border-l md:[&>div+div]:border-t-line md:[&>div+div]:pl-8">
        {groups.map((g) => (
          <div key={g.key} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <PolicyDecision decision={g.key} className="text-t-label" />
              <span className="t-num text-t-caption text-t-muted">{g.items.length}</span>
            </div>
            <p className="text-t-caption text-t-muted">{g.title}</p>
            <ul className="flex flex-col gap-2 text-t-small text-t-text">
              {g.items.map((i) => (
                <li key={i} className="flex gap-2 leading-snug">
                  <span aria-hidden className="mt-[0.55em] h-px w-2.5 shrink-0 bg-t-subtle" />
                  {i}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Integration card */

export interface IntegrationData {
  name: string;
  brand?: BrandSlug;
  kind: string;
  blurb: string;
  status: "connected" | "compatible" | "planned";
}
const INTEGRATION_STATUS: Record<IntegrationData["status"], { label: string; tone: Tone; action: string | null }> = {
  connected: { label: "Connected", tone: "ok", action: "Manage" },
  compatible: { label: "Compatible", tone: "info", action: "Connect" },
  planned: { label: "Planned", tone: "neutral", action: null },
};

/** One way to put TEND in front of an agent. Statuses use the product's own vocabulary; "planned" never offers a connect button. */
export function IntegrationCard({ data, className }: { data: IntegrationData; className?: string }) {
  const s = INTEGRATION_STATUS[data.status];
  return (
    <article className={cx("group flex flex-col gap-4 rounded-t-lg border border-t-line bg-t-surface p-5 shadow-t-1 transition-[border-color,box-shadow] duration-(--t-dur-base) ease-t-out hover:border-t-line-strong hover:shadow-t-2", className)}>
      <div className="flex items-start justify-between gap-3">
        <AgentAvatar brand={data.brand} size={40} />
        <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-t-h4 text-t-ink">{data.name}</h3>
        <p className="text-t-caption text-t-muted">{data.kind}</p>
        <p className="mt-2 text-t-small text-t-text">{data.blurb}</p>
      </div>
      <div className="mt-auto pt-1">
        {s.action ? (
          <Button variant={data.status === "connected" ? "secondary" : "primary"} size="sm">
            {s.action}
          </Button>
        ) : (
          <span className="text-t-caption text-t-muted">Nothing to connect yet</span>
        )}
      </div>
    </article>
  );
}


