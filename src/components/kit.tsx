"use client";

import Link from "next/link";
import { Suspense } from "react";
import { CloudOffIcon, InfoIcon } from "lucide-react";
import { SignIn } from "@/components/sign-in";
import { Button } from "@/components/ui/button";
import { isOnline } from "@/lib/projection";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n/client";
import { QUESTIONS } from "@/lib/contract";
import { hasConcern, health } from "@/lib/derive";
import { useStore } from "@/lib/store";
import type { Agent, Answer, CheckIn } from "@/lib/types";
import { cn, CONTAINER } from "@/lib/utils";

export type Tone = "sage" | "amber" | "muted" | "white" | "off";

const TONE: Record<Tone, string> = {
  sage: "bg-sage",
  amber: "bg-amber",
  muted: "bg-faint",
  white: "bg-foreground",
  off: "border border-faint bg-transparent",
};

export function Dot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex size-1.5 shrink-0 rounded-full", TONE[tone], className)}>
      {pulse && <span className={cn("absolute inset-0 animate-[lamp_3.2s_ease-in-out_infinite] rounded-full motion-reduce:hidden", TONE[tone])} />}
    </span>
  );
}

/** Says plainly whether an agent is simulated by the server or connected through the API, and what that means. */
export function OriginTag({ agent, className }: { agent: Agent; className?: string }) {
  const t = useT();
  const connected = agent.origin === "connected";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex h-[18px] cursor-help items-center gap-1.5 rounded-[3px] border px-1.5 font-mono text-meta", connected ? "border-sage/40 text-sage" : "border-border text-faint", className)}>
          {connected ? t.origin.connected : t.origin.simulated}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-60 leading-relaxed">{connected ? t.origin.connectedTip : t.origin.simulatedTip}</TooltipContent>
    </Tooltip>
  );
}

export type StateKey = "active" | "idle" | "paused" | "disabled" | "offline";

export function agentState(a: Agent, now = Date.now()): { key: StateKey; tone: Tone } {
  if (!a.integrationEnabled) return { key: "disabled", tone: "off" };
  if (a.status === "paused") return { key: "paused", tone: "off" };
  if (!isOnline(a, now)) return { key: "offline", tone: "off" };
  if (a.status === "idle") return { key: "idle", tone: "muted" };
  return { key: "active", tone: "sage" };
}

export function AgentState({ agent, className }: { agent: Agent; className?: string }) {
  const t = useT();
  const s = agentState(agent);
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <Dot tone={s.tone} />
      {t.state.label[s.key]}
    </span>
  );
}

/** Operational health: a label derived from the last five check-ins, explained in its tooltip. */
export function Health({ recent, className }: { recent: CheckIn[]; className?: string }) {
  const t = useT();
  const h = health(recent);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex cursor-default items-center gap-2.5 text-sm text-muted-foreground", className)}>
          <span className="flex gap-[3px]" aria-hidden>
            {Array.from({ length: 5 }, (_, i) => {
              const c = recent[4 - i];
              const tone = !c ? "bg-elevated" : c.review?.status === "pending" ? "bg-amber" : hasConcern(c) ? "bg-faint" : "bg-sage/70";
              return <span key={i} className={cn("h-3 w-[3px] rounded-full", tone)} />;
            })}
          </span>
          {t.health[h.level]}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-60 leading-relaxed">{t.health.tip(h.n || 5, h.issues, h.level === "review")}</TooltipContent>
    </Tooltip>
  );
}

const ANSWER_TONE = (concern: boolean, a: Answer) => (concern ? "bg-amber/80" : a === "unsure" ? "bg-faint" : "bg-sage/60");

/** Five glyphs, one per protocol question. Amber marks an answer that signals a concern. */
export function AnswerGlyphs({ checkIn, className }: { checkIn: CheckIn; className?: string }) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex cursor-default gap-1", className)} aria-label={t.feed.answers}>
          {QUESTIONS.map((q) => {
            const r = checkIn.responses[q.id];
            return <span key={q.id} className={cn("size-2 rounded-[2px]", ANSWER_TONE(q.concern.includes(r.answer), r.answer))} />;
          })}
        </span>
      </TooltipTrigger>
      <TooltipContent className="block p-2.5">
        <ul className="grid gap-1.5">
          {QUESTIONS.map((q) => {
            const r = checkIn.responses[q.id];
            return (
              <li key={q.id} className="flex items-center justify-between gap-6">
                <span className="text-muted-foreground">{t.questions[q.id].short}</span>
                <span className="font-mono text-meta">
                  {t.answers[r.answer]} <span className="text-faint">· {t.pct(r.confidence)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

export function Info({ children, className }: { children: React.ReactNode; className?: string }) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={t.common.explanation} className={cn("inline-flex text-faint transition-colors hover:text-muted-foreground", className)}>
          <InfoIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}

export function PageHeader({
  title, description, actions, className,
}: { eyebrow?: string; term?: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <header className={cn("mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between", className)}>
      <div className="max-w-2xl">
        <h1 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em] text-balance">{title}</h1>
        {description && <p className="mt-2 max-w-[60ch] text-[15px] text-pretty text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** The original name of a section, for readers who know it by that name. */
export function Term({ term }: { term: string }) {
  const t = useT();
  return <Info className="normal-case">{t.nav.alsoCalled(term)}</Info>;
}

export function Panel({
  title, action, children, className, bodyClassName,
}: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("min-w-0", className)}>
      {(title || action) && (
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-h2">{title}</h2>
          {action}
        </div>
      )}
      <div className={cn("mt-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({
  label, value, hint, info, href, tone,
}: { label: string; value: React.ReactNode; hint?: React.ReactNode; info?: React.ReactNode; href?: string; tone?: Tone }) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-small text-muted-foreground">
        {tone && <Dot tone={tone} className="mr-0.5" />}
        {label}
        {info && <Info>{info}</Info>}
      </div>
      <div className="numeric mt-2 text-figure">{value}</div>
      {hint && <div className="mt-2 text-xs text-faint">{hint}</div>}
    </>
  );
  const cls = "block border-b border-border px-1 py-5 transition-colors md:px-5";
  return href ? (
    <Link href={href} className={cn(cls, "hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none")}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A row of stats separated by hairlines rather than boxed into separate cards. */
export function StatRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 border-t border-border md:grid-cols-4 max-md:[&>*:nth-child(odd)]:border-r md:[&>*:not(:last-child)]:border-r", className)}>
      {children}
    </div>
  );
}

export function Empty({ title, body, action }: { icon?: React.ElementType; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <p className="text-heading text-balance">{title}</p>
      {body && <p className="mt-2 max-w-[44ch] text-body text-pretty text-muted-foreground">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Renders a page once the server snapshot has loaded; a skeleton until then (and during prerender). */
export function Gate({ children, bleed }: { children: React.ReactNode; bleed?: boolean }) {
  const t = useT();
  const ready = useStore((s) => s.ready);
  const status = useStore((s) => s.status);
  const skeleton = bleed ? <WorldLoading /> : <div className={CONTAINER}><PageSkeleton /></div>;
  if (status === "signin") return <div className={CONTAINER}><SignIn /></div>;
  if (!ready && status === "reconnecting")
    return (
      <div className={CONTAINER}>
        <Empty icon={CloudOffIcon} title={t.server.unreachable} body={t.server.retrying}
          action={<Button variant="outline" onClick={() => void useStore.getState().init()}>{t.server.tryAgain}</Button>} />
      </div>
    );
  return <Suspense fallback={skeleton}>{ready ? <div className={bleed ? "h-full" : CONTAINER}>{children}</div> : skeleton}</Suspense>;
}

/** The world's loading state: a quiet line where the scene will be. */
function WorldLoading() {
  const t = useT();
  return (
    <div aria-busy="true" className="flex h-[calc(100dvh-48px)] flex-col items-center justify-center gap-4 lg:h-dvh">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-[lamp_1.4s_ease-in-out_infinite] bg-sage motion-reduce:animate-none" style={{ animationDelay: `${i * 0.2}s` }} />)}
      </span>
      <p className="font-mono text-meta text-faint">{t.server.loadingWorld}</p>
    </div>
  );
}

export function PageSkeleton() {
  const t = useT();
  return (
    <div aria-busy="true" aria-label={t.common.loading} className="grid gap-4">
      <Skeleton className="h-10 w-2/3 rounded-xl" />
      <Skeleton className="h-5 w-1/2 rounded-lg" />
      <Skeleton className="mt-10 h-48 w-full rounded-3xl" />
    </div>
  );
}

export function AgentAvatar({ agent, size = "md" }: { agent: Agent; size?: "sm" | "md" | "lg" }) {
  return (
    <span aria-hidden className={cn("inline-grid shrink-0 place-items-center rounded-full bg-sunken font-medium text-muted-foreground", size === "sm" ? "size-6 text-caption" : size === "md" ? "size-8 text-small" : "size-12 text-ui")}>
      {agent.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Single-choice segmented control with radio semantics and arrow-key support. */
export function Segmented<T extends string>({
  value, onChange, options, label, className,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; label: string; className?: string }) {
  const move = (dir: number) => {
    const i = options.findIndex((o) => o.value === value);
    onChange(options[(i + dir + options.length) % options.length].value);
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-full bg-sunken p-0.5", className)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      }}>
      {options.map((o, i) => {
        const active = o.value === value;
        const focusable = active || (i === 0 && !options.some((x) => x.value === value));
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} tabIndex={focusable ? 0 : -1} onClick={() => onChange(o.value)}
            className={cn(
              "h-8 flex-1 rounded-full px-3.5 text-small whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              active ? "bg-surface font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted-foreground hover:text-foreground",
            )}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function AgentSelect({ value, onChange, includeAll = true, className }: { value: string; onChange: (v: string) => void; includeAll?: boolean; className?: string }) {
  const t = useT();
  const agents = useStore((s) => s.agents);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("h-10! w-full rounded-full sm:w-48", className)} aria-label={t.common.agent}><SelectValue placeholder={t.common.chooseAgent} /></SelectTrigger>
      <SelectContent>
        {includeAll && <SelectItem value="all">{t.common.allAgents}</SelectItem>}
        {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
