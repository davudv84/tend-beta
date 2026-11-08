"use client";

import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { PrimaryLink, QuietLink } from "./kit";
import { Reveal } from "./reveal";

// The parts every page of the public site is built from, in the homepage's look: the large sans headings, the charcoal surfaces with
// hairline borders, the white pills. Each page (components/marketing/pages) only arranges them and brings its words from the dictionary.

/** The top of a page: "TEND / …", the large title and one paragraph. */
export function PageHeader({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead?: string; children?: React.ReactNode }) {
  const t = useT();
  return (
    <section className="px-5 pt-14 pb-6 sm:px-8 md:pt-24">
      <div className="mx-auto max-w-[1136px]">
        <p className="text-[14px] text-muted-foreground">{t.front.product.crumb(eyebrow)}</p>
        <h1 className="mk-display mt-5 max-w-[18ch] text-[clamp(2.6rem,6.4vw,5rem)]">{title}</h1>
        {lead && <p className="mt-6 max-w-[60ch] text-[16px] leading-relaxed text-foreground/80 md:text-[17px]">{lead}</p>}
        {children}
      </div>
    </section>
  );
}

/** A section of a page: a serif heading, an optional line under it, and its content. */
export function PageSection({ id, title, lead, children, className }: { id?: string; title: string; lead?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn("scroll-mt-28 px-5 pt-16 sm:px-8 md:pt-24", className)}>
      <Reveal className="mx-auto max-w-[1136px]">
        <h2 id={id ? `${id}-title` : undefined} className="mk-heading max-w-[24ch] text-[clamp(1.875rem,3.6vw,2.75rem)]">{title}</h2>
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
    <li className={cn("flex flex-col rounded-2xl border border-white/[0.08] bg-mk-surface p-6", className)}>
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
        <li key={title} className="flex flex-col rounded-2xl border border-white/[0.08] bg-mk-surface p-6">
          <span aria-hidden className="grid size-8 place-items-center rounded-full border border-white/[0.14] text-[13px] font-medium tabular-nums">{i + 1}</span>
          <p className="mt-5 text-[17px] font-medium tracking-[-0.01em] text-balance">{title}</p>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{body}</p>
        </li>
      ))}
    </ol>
  );
}

/** A wide dark card for running text or a single point. */
export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("relative overflow-hidden rounded-2xl border border-white/[0.08] bg-mk-surface p-6 md:p-10", className)}>{children}</div>;
}

/** Long text in readable measure: the legal pages. Each block is a heading and its paragraphs or list. */
export function Prose({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1200px] px-5 sm:px-8"><div className="max-w-[72ch] space-y-12 pt-10 text-[15px] leading-relaxed text-foreground/85">{children}</div></div>;
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

/** The end of a page: one line and the two ways on, in the homepage's closing style. */
export function EndBand({ title, accounts, secondary }: { title: string; accounts: boolean; secondary?: { label: string; href: string } }) {
  const t = useT();
  return (
    <section className="mt-24 border-t border-white/[0.08] px-5 py-20 sm:px-8 md:mt-32 md:py-28">
      <Reveal className="mx-auto max-w-[1136px] text-center">
        <h2 className="mk-display mx-auto max-w-[20ch] text-[clamp(2rem,4.6vw,3.5rem)]">{title}</h2>
        <div className="mt-8 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
          <PrimaryLink href={accounts ? "/account/sign-up" : "/operator"} size="lg">{t.front.create}</PrimaryLink>
          {secondary && <QuietLink href={secondary.href} size="lg">{secondary.label}</QuietLink>}
        </div>
      </Reveal>
    </section>
  );
}

/** A quiet link to another page, with an arrow. */
export function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex items-center gap-1.5 rounded-sm text-[14px] font-medium text-foreground underline-offset-4 hover:underline">{children}<ArrowRightIcon className="size-3.5" aria-hidden /></Link>;
}
