"use client";

import { LinkIcon, MousePointer2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { HISTORY, INVOICE_REQUEST, OPS_AGENT } from "./demo-data";
import { Eyebrow } from "./eyebrow";
import { Landscape } from "./landscape";
import { pill } from "./pill";
import { Reveal } from "./reveal";
import type { HomeImages } from "./types";

/** Four cards, two rows: narrow + wide, then wide + narrow. A small dark piece of each screen on top, hills and the name below. */
export function Features({ images }: { images: HomeImages }) {
  const t = useT();
  const f = t.front.features;
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-24 px-6 pt-24 md:px-8 md:pt-32">
      <Reveal className="mx-auto flex max-w-[1240px] flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <Eyebrow>{f.eyebrow}</Eyebrow>
          <h2 id="features-title" className="mt-6 max-w-[18ch] font-serif text-[clamp(2.25rem,4.6vw,3.5rem)] leading-[1.08] font-light tracking-[-0.025em] text-balance">{f.title}</h2>
        </div>
        <p className="max-w-[34ch] text-[14px] text-muted-foreground md:text-right">{f.body}</p>
      </Reveal>
      <div className="mx-auto mt-10 grid max-w-[1240px] gap-4 md:mt-14 md:grid-cols-3">
        <FeatureCard title={f.rules.title} body={f.rules.body} alt={f.rules.alt} images={images}><RulesMini /></FeatureCard>
        <FeatureCard title={f.approvals.title} body={f.approvals.body} alt={f.approvals.alt} images={images} wide delay={60}><ApprovalMini /></FeatureCard>
        <FeatureCard title={f.activity.title} body={f.activity.body} alt={f.activity.alt} images={images} wide delay={120}><ActivityMini /></FeatureCard>
        <FeatureCard title={f.checks.title} body={f.checks.body} alt={f.checks.alt} images={images} delay={180}><ChecksMini /></FeatureCard>
      </div>
    </section>
  );
}

function FeatureCard({ title, body, alt, images, wide, delay, children }: { title: string; body: string; alt: string; images: HomeImages; wide?: boolean; delay?: number; children: React.ReactNode }) {
  return (
    <Reveal as="article" delay={delay} className={cn("relative flex min-h-[420px] flex-col overflow-hidden rounded-3xl border border-border bg-mk-surface", wide && "md:col-span-2")}>
      <div role="img" aria-label={alt} className="relative flex-1 px-6 pt-6 md:px-8 md:pt-8"><div aria-hidden className="h-full">{children}</div></div>
      <div className="relative mt-4 h-[200px]">
        <Landscape src={images.footer} tone="night" position="center 70%" sizes="(min-width: 768px) 66vw, 100vw" mask="linear-gradient(to bottom, transparent, black 55%)" />
        <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,rgb(13_15_14/0.85),transparent)] px-6 pt-10 pb-7 text-center">
          <h3 className="font-serif text-[26px] leading-tight font-light tracking-[-0.01em]">{title}</h3>
          <p className="mx-auto mt-2 max-w-[42ch] text-[13px] text-muted-foreground">{body}</p>
        </div>
      </div>
    </Reveal>
  );
}

/** A small dark surface, the raised one from the tokens. */
const Mini = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("rounded-xl border border-border bg-mk-raised shadow-[0_20px_60px_-30px_rgb(0_0_0/0.9)]", className)}>{children}</div>
);

function RulesMini() {
  const t = useT();
  const c = t.tools.choice;
  const rows: [string, string, string][] = [
    ["file.read", "*", c.allow],
    ["shell", `contains “git push”`, c.ask],
    ["file.read", `path contains “.ssh/”`, c.never],
  ];
  return (
    <Mini className="mx-auto max-w-[360px]">
      <p className="border-b border-border px-4 py-2.5 text-[12px] font-medium">{t.ui.nav.policies}</p>
      <ul className="divide-y divide-border">
        {rows.map(([tool, when, choice]) => (
          <li key={tool + when} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0"><span className="block font-mono text-[12px]">{tool}</span><span className="block truncate text-[11px] text-muted-foreground">{when}</span></span>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", choice === c.never ? "bg-[#3a1f1b] text-[#f0a899]" : choice === c.ask ? "bg-[#3a2a12] text-[#f0c27a]" : "bg-[#163626] text-[#8fd3b4]")}>{choice}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">{t.front.features.rules.note}</p>
    </Mini>
  );
}

function ApprovalMini() {
  const t = useT();
  const h = t.home.request;
  const s = t.home.dash.stats;
  return (
    <div className="relative mx-auto max-w-[520px]">
      <Mini className="p-5">
        <p className="flex items-center gap-2 text-[12px] font-medium"><span className="size-1.5 rotate-45 bg-[#f0c27a]" />{s.waiting}</p>
        <p className="mt-2 text-[16px] font-medium">{h.sentence(INVOICE_REQUEST.tool, OPS_AGENT.name, INVOICE_REQUEST.resource ?? "", INVOICE_REQUEST.action)}</p>
        <p className="mt-3 rounded-lg bg-black/30 px-3 py-2 font-mono text-[12px] text-foreground/90">{INVOICE_REQUEST.detail}</p>
        <div className="mt-4 flex items-center gap-2">
          <Button className={pill("light")} tabIndex={-1}>{h.allow}</Button>
          <Button variant="secondary" className={pill("dark")} tabIndex={-1}>{h.deny}</Button>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">{t.front.features.approvals.once}</p>
      </Mini>
      <span className="absolute top-[172px] left-[236px] hidden items-start whitespace-nowrap sm:flex">
        <MousePointer2Icon className="size-4 fill-white text-white" strokeWidth={1.5} />
        <span className="-mt-0.5 ml-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#171717]">{t.front.why.flow.bubble}</span>
      </span>
    </div>
  );
}

const HASHES = ["3f9a1c", "b72e04", "c41d88", "8e07f2"];

function ActivityMini() {
  const t = useT();
  const o = t.timelinePage.outcome;
  return (
    <Mini className="mx-auto max-w-[620px]">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-[12px] font-medium">{t.ui.nav.activity}</p>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><LinkIcon className="size-3" strokeWidth={1.75} />{t.front.features.activity.chain}</p>
      </div>
      <ul className="divide-y divide-border">
        {HISTORY.map((d, i) => (
          <li key={d.time} className="grid grid-cols-[42px_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2.5 text-[12px]">
            <span className="text-muted-foreground tabular-nums">{d.time}</span>
            <span className="min-w-0"><span className="block truncate font-mono">{d.detail}</span><span className="block text-[11px] text-muted-foreground">{d.agent.name}</span></span>
            <span className={cn("font-medium", d.outcome === "blocked" || d.outcome === "rejected" ? "text-[#f0a899]" : "text-foreground")}>{o[d.outcome]}</span>
            <span className="hidden font-mono text-[11px] text-muted-foreground sm:block">#{HASHES[i + 1]} ← #{HASHES[i]}</span>
          </li>
        ))}
      </ul>
    </Mini>
  );
}

function ChecksMini() {
  const t = useT();
  const p = t.protection;
  const rows: ["forbidden_refused" | "approval_once" | "agent_isolated", "verified" | "not_verified"][] = [["forbidden_refused", "verified"], ["approval_once", "verified"], ["agent_isolated", "not_verified"]];
  return (
    <Mini className="mx-auto max-w-[360px]">
      <p className="border-b border-border px-4 py-2.5 text-[12px] font-medium">{t.ui.nav.verification}</p>
      <ul className="divide-y divide-border">
        {rows.map(([id, status]) => (
          <li key={id} className="flex items-start gap-3 px-4 py-2.5">
            <span className={cn("mt-[5px] size-2 shrink-0 rounded-full", status === "verified" ? "bg-sage" : "border border-muted-foreground")} />
            <span className="min-w-0"><span className="block text-[12px] leading-snug">{p.checks[id].title}</span><span className={cn("mt-0.5 block text-[11px]", status === "verified" ? "text-sage" : "text-muted-foreground")}>{p.status[status]}</span></span>
          </li>
        ))}
      </ul>
    </Mini>
  );
}
