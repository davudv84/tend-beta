"use client";

import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./eyebrow";
import { pill } from "./pill";
import { Reveal } from "./reveal";

// The parts every page of the public site is built from, in the homepage's look: the serif headings, the dark surfaces with hairline
// borders, the white pills. Each page (components/marketing/pages) only arranges them and brings its words from the dictionary.

/** The top of a page: the pill, the serif title and one paragraph, clear of the header that floats over it. */
export function PageHeader({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead?: string; children?: React.ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden px-6 pt-36 pb-6 md:px-8 md:pt-44">
      <div aria-hidden className="pointer-events-none absolute -top-64 left-1/2 -z-10 size-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(95_184_146/0.10),transparent)]" />
      <div className="mx-auto max-w-[1240px]">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-6 max-w-[20ch] font-serif text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.04] font-light tracking-[-0.03em] text-balance">{title}</h1>
        {lead && <p className="mt-6 max-w-[60ch] text-[16px] leading-relaxed text-foreground/80 md:text-[17px]">{lead}</p>}
        {children}
      </div>
    </section>
  );
}

/** A section of a page: a serif heading, an optional line under it, and its content. */
export function PageSection({ id, title, lead, children, className }: { id?: string; title: string; lead?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn("scroll-mt-24 px-6 pt-16 md:px-8 md:pt-24", className)}>
      <Reveal className="mx-auto max-w-[1240px]">
        <h2 id={id ? `${id}-title` : undefined} className="max-w-[24ch] font-serif text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.1] font-light tracking-[-0.02em] text-balance">{title}</h2>
        {lead && <div className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">{lead}</div>}
        {children && <div className="mt-8 md:mt-10">{children}</div>}
      </Reveal>
    </section>
  );
}

/** Cards in a grid, like the homepage's "what it does" cards: a small label, a title and a few lines. */
export function CardGrid({ children, cols = 3 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) {
  return <ul className={cn("grid gap-4 sm:grid-cols-2", cols === 3 && "lg:grid-cols-3", cols === 4 && "lg:grid-cols-4")}>{children}</ul>;
}
export function InfoCard({ label, icon, title, children, className }: { label?: string; icon?: React.ReactNode; title: string; children?: React.ReactNode; className?: string }) {
  return (
    <li className={cn("flex flex-col rounded-2xl border border-border bg-mk-surface p-6", className)}>
      {(label || icon) && <p className="flex items-center gap-2 text-[12px] text-muted-foreground">{icon}{label}</p>}
      <p className={cn("text-[17px] font-medium tracking-[-0.01em] text-balance", (label || icon) && "mt-4")}>{title}</p>
      {children && <div className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{children}</div>}
    </li>
  );
}

/** Numbered steps, one card each. */
export function Steps({ items }: { items: readonly (readonly [string, string])[] }) {
  return (
    <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {items.map(([title, body], i) => (
        <li key={title} className="flex flex-col rounded-2xl border border-border bg-mk-surface p-6">
          <span aria-hidden className="grid size-8 place-items-center rounded-full bg-white text-[13px] font-semibold text-[#171717] tabular-nums">{i + 1}</span>
          <p className="mt-5 text-[17px] font-medium tracking-[-0.01em] text-balance">{title}</p>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{body}</p>
        </li>
      ))}
    </ol>
  );
}

/** A wide dark card for running text or a single point. */
export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("relative overflow-hidden rounded-3xl border border-border bg-mk-surface p-6 md:p-10", className)}>{children}</div>;
}

/** Long text in readable measure: the legal pages. Each block is a heading and its paragraphs or list. */
export function Prose({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1240px] px-6 md:px-8"><div className="max-w-[72ch] space-y-12 pt-10 text-[15px] leading-relaxed text-foreground/85">{children}</div></div>;
}
export function ProseBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[20px] font-medium tracking-[-0.01em] text-foreground">{title}</h2>
      {children}
    </section>
  );
}
export function Bullets({ items }: { items: readonly React.ReactNode[] }) {
  return (
    <ul className="grid gap-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3"><span aria-hidden className="mt-[10px] size-1.5 shrink-0 rounded-full bg-muted-foreground" /><span className="text-pretty">{item}</span></li>
      ))}
    </ul>
  );
}

/**
 * A detail that only the owner can give and has not given yet (components/marketing/site.ts). Shown as a marked gap, never as an
 * invented value, so it is plain what is missing.
 */
export function Gap({ what }: { what: string }) {
  const t = useT();
  return <span className="inline-flex items-center rounded-md border border-dashed border-[#d9a55b]/60 bg-[rgb(217_165_91/0.08)] px-2 py-0.5 text-[0.92em] text-[#e4ba7a]">{t.front.pages.gap(what)}</span>;
}
/** Says at the top of a page that it still has gaps. */
export function Completing() {
  const t = useT();
  return <p role="note" className="mt-8 max-w-[64ch] rounded-2xl border border-dashed border-[#d9a55b]/50 bg-[rgb(217_165_91/0.06)] px-5 py-4 text-[14px] text-[#e4ba7a]">{t.front.pages.completing}</p>;
}

/** The end of a page: one line and the two ways on, as on the homepage. */
export function EndBand({ title, accounts, secondary }: { title: string; accounts: boolean; secondary?: { label: string; href: string } }) {
  const t = useT();
  return (
    <section className="px-6 pt-24 md:px-8 md:pt-32">
      <Reveal className="relative mx-auto max-w-[1240px] overflow-hidden rounded-3xl border border-border bg-mk-surface p-8 md:p-12">
        <div aria-hidden className="pointer-events-none absolute -top-48 -right-24 size-[560px] rounded-full bg-white/[0.025]" />
        <div className="relative flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <h2 className="max-w-[20ch] font-serif text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.1] font-light tracking-[-0.02em] text-balance">{title}</h2>
          <div className="flex flex-wrap gap-3">
            <Button asChild className={pill("light", "lg")}><Link href={accounts ? "/account/sign-up" : "/operator"}>{t.front.create}</Link></Button>
            {secondary && <Button asChild variant="secondary" className={pill("dark", "lg")}><Link href={secondary.href}>{secondary.label} <ArrowRightIcon className="size-4" aria-hidden /></Link></Button>}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/** A quiet link to another page, with an arrow. */
export function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex items-center gap-1.5 rounded-sm text-[14px] font-medium text-foreground underline-offset-4 hover:underline">{children}<ArrowRightIcon className="size-3.5" aria-hidden /></Link>;
}
