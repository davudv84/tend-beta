"use client";

import Link from "next/link";
import { ArrowLeftIcon, ArrowUpRightIcon, BoxesIcon, CheckIcon, ChevronRightIcon, CodeIcon, KeyRoundIcon, LayersIcon, MinusIcon, ServerIcon, UserCheckIcon, XIcon } from "lucide-react";
import { useLocale, useT } from "@/i18n/client";
import { BRAND_ICONS } from "@/lib/brand-icons";
import { cn } from "@/lib/utils";
import { CHECKED, COMPETITORS, SECTIONS, TEND, TEND_ABOUT, TEND_STANDOUT, type Cell, type Competitor, type Kind } from "../compare-data";
import { LogoTile } from "../logo";
import { EndBand, MoreLink, PageHeader } from "../page-parts";
import { Reveal } from "../reveal";

// The comparison pages, laid out as sim.ai's "Sim vs …" pages: what each product is, a table per area with the two products as
// columns, what stands out and what is documented as missing, the bottom line, the sources with the day they were read, and the
// other comparisons. Every fact is in compare-data.ts; this file only arranges it.

const GLYPH: Record<Exclude<Kind, "claudecode">, typeof BoxesIcon> = { approval: UserCheckIcon, identity: KeyRoundIcon, library: CodeIcon, gateway: ServerIcon, runtime: LayersIcon, framework: BoxesIcon };

/** The other product's tile: Claude Code's own mark, otherwise a neutral glyph for its kind. Decorative: the name is always next to it. */
function Tile({ kind, className }: { kind: Kind; className?: string }) {
  const Glyph = kind === "claudecode" ? null : GLYPH[kind];
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-xl border border-white/[0.12] bg-white/[0.05] text-foreground/85", className)}>
      {Glyph ? <Glyph className="size-[48%]" strokeWidth={1.6} /> : <svg viewBox="0 0 24 24" className="size-[52%] fill-current"><path d={BRAND_ICONS.claudecode.path} /></svg>}
    </span>
  );
}

/** Where front.pages.compare.relatedItems lead, in the same order. */
const RELATED = ["/how-it-works", "/security", "/verification-report"] as const;

const useChecked = () => {
  const { locale } = useLocale();
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${CHECKED}T12:00:00Z`));
};

/** "TEND vs X" rows: the tile, the title, one line, a chevron. */
function CompareList({ items, label }: { items: Competitor[]; label: string }) {
  const c = useT().front.pages.compare;
  return (
    <ul aria-label={label} className="divide-y divide-white/[0.08] overflow-hidden rounded-2xl border border-white/[0.08] bg-mk-surface">
      {items.map((x) => (
        <li key={x.slug}>
          <Link href={`/compare/${x.slug}`} className="group flex items-center gap-4 px-5 py-4 outline-none transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.05] md:px-6 md:py-5">
            <Tile kind={x.kind} className="size-10" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15.5px] font-medium tracking-[-0.01em]">{c.vs(x.name)}</span>
              <span className="mt-0.5 block text-[13.5px] leading-snug text-muted-foreground">{x.short}</span>
            </span>
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** /compare: every comparison, then where TEND is weaker against all of them. */
export function CompareIndex({ accounts }: { accounts: boolean }) {
  const c = useT().front.pages.compare;
  const checked = useChecked();
  return (
    <>
      <PageHeader eyebrow={c.eyebrow} title={c.title} lead={c.lead(checked)} />
      <section className="px-5 pt-8 sm:px-8 md:pt-12">
        <div className="mx-auto max-w-[1136px]">
          <CompareList items={COMPETITORS} label={c.listLabel} />
          <p className="mt-4 text-[13px] text-muted-foreground">{c.factsNote}</p>
        </div>
      </section>
      <Weaker />
      <EndBand title={c.end} accounts={accounts} secondary={{ label: c.endLink, href: "/how-it-works" }} />
    </>
  );
}

function Weaker() {
  const c = useT().front.pages.compare;
  return (
    <section aria-labelledby="weaker-title" className="px-5 pt-16 sm:px-8 md:pt-24">
      <Reveal className="mx-auto max-w-[1136px]">
        <h2 id="weaker-title" className="mk-heading max-w-[24ch] text-[clamp(1.6rem,3vw,2.25rem)]">{c.weaker}</h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {c.weakerItems.map(([title, body]) => (
            <li key={title} className="rounded-2xl border border-white/[0.08] bg-mk-surface p-6">
              <p className="flex items-center gap-2 text-[16px] font-medium tracking-[-0.01em]"><MinusIcon className="size-3.5 text-muted-foreground" strokeWidth={2} aria-hidden />{title}</p>
              <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6"><MoreLink href="/security">{c.weakerLink}</MoreLink></p>
      </Reveal>
    </section>
  );
}

/** One cell: a tick, a cross, the words, or "Not documented" in a quieter tone. */
function Value({ v }: { v: Cell }) {
  const c = useT().front.pages.compare;
  if (v === true) return <span className="inline-flex items-center gap-1.5 text-foreground"><CheckIcon className="size-4 text-sage" strokeWidth={2.25} aria-hidden /><span className="sr-only">{c.yes}</span></span>;
  if (v === false) return <span className="inline-flex items-center gap-1.5 text-muted-foreground"><XIcon className="size-4" strokeWidth={2} aria-hidden /><span className="sr-only">{c.no}</span></span>;
  if (v === null) return <span className="text-muted-foreground/70">{c.notDocumented}</span>;
  return <span className="text-foreground/85">{v}</span>;
}

/** A section's table: the feature, TEND, the other product. On a phone each row stacks: the feature, then the two values side by side. */
function Table({ title, rows, them }: { title: string; rows: [string, Cell, Cell][]; them: Competitor }) {
  const c = useT().front.pages.compare;
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-mk-surface">
      <table className="w-full border-collapse text-left text-[14px] leading-snug max-md:block md:table-fixed">
        <caption className="sr-only">{c.tableLabel(title, them.name)}</caption>
        <colgroup className="max-md:hidden"><col className="w-[28%]" /><col /><col /></colgroup>
        <thead className="border-b border-white/[0.08] bg-white/[0.02] max-md:block">
          <tr className="max-md:grid max-md:grid-cols-2">
            <th scope="col" className="hidden px-5 py-3.5 text-[12.5px] font-normal text-muted-foreground md:table-cell">{c.feature}</th>
            <th scope="col" className="px-4 py-3.5 font-normal md:px-5"><span className="flex items-center gap-2.5"><LogoTile className="size-7 rounded-lg" /><span className="text-[13.5px] font-medium">TEND</span></span></th>
            <th scope="col" className="px-4 py-3.5 font-normal md:px-5"><span className="flex items-center gap-2.5"><Tile kind={them.kind} className="size-7 rounded-lg" /><span className="text-[13.5px] font-medium">{them.name}</span></span></th>
          </tr>
        </thead>
        <tbody className="max-md:block">
          {rows.map(([label, a, b]) => (
            <tr key={label} className="border-b border-white/[0.06] last:border-0 max-md:grid max-md:grid-cols-2">
              <th scope="row" className="px-4 pt-4 pb-1 text-[13px] font-medium text-muted-foreground max-md:col-span-2 md:table-cell md:px-5 md:py-4 md:align-top md:text-[14px] md:text-foreground/90">{label}</th>
              <td className="px-4 pt-1 pb-4 align-top md:px-5 md:py-4"><Value v={a} /></td>
              <td className="px-4 pt-1 pb-4 align-top md:px-5 md:py-4"><Value v={b} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Heading({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  return <h2 id={id} className={cn("mk-heading scroll-mt-28 text-[clamp(1.6rem,3vw,2.25rem)]", className)}>{children}</h2>;
}

function Card({ title, items, icon }: { title: string; items: [string, string][]; icon: "check" | "minus" }) {
  const Icon = icon === "check" ? CheckIcon : MinusIcon;
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-mk-surface p-6 md:p-8">
      <h3 className="text-[18px] font-medium tracking-[-0.01em]">{title}</h3>
      <ul className="mt-5 grid gap-4">
        {items.map(([head, body]) => (
          <li key={head} className="flex gap-3">
            <Icon className={cn("mt-1 size-4 shrink-0", icon === "check" ? "text-sage" : "text-muted-foreground")} strokeWidth={2} aria-hidden />
            <span><span className="block text-[15px] font-medium">{head}</span><span className="mt-1 block text-[14px] leading-relaxed text-muted-foreground">{body}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** /compare/[slug]: TEND vs one product. */
export function ComparePage({ them, accounts }: { them: Competitor; accounts: boolean }) {
  const c = useT().front.pages.compare;
  const checked = useChecked();
  const others = COMPETITORS.filter((x) => x.slug !== them.slug);
  const wrap = "mx-auto max-w-[1136px]";
  return (
    <>
      <section className="px-5 pt-10 pb-2 sm:px-8 md:pt-16">
        <div className={wrap}>
          <Link href="/compare" className="inline-flex items-center gap-1.5 rounded-sm text-[14px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
            <ArrowLeftIcon className="size-3.5" aria-hidden />{c.back}
          </Link>
          <h1 className="mk-display mt-8 max-w-[20ch] text-[clamp(2.4rem,6vw,4.5rem)]">{c.vs(them.name)}</h1>
          <p className="mt-6 max-w-[68ch] text-[15.5px] leading-relaxed text-foreground/80 md:text-[16.5px]">{c.intro(them.name, checked)}</p>
          <p className="mt-3 text-[13px] text-muted-foreground">{c.factsNote}</p>
        </div>
      </section>

      <section className="px-5 pt-10 sm:px-8 md:pt-14">
        <div className={cn(wrap, "grid gap-4 md:grid-cols-2")}>
          {([["TEND", TEND_ABOUT, <LogoTile key="t" className="size-10" />], [them.name, them.about, <Tile key="x" kind={them.kind} className="size-10" />]] as const).map(([name, about, tile]) => (
            <div key={name} className="rounded-2xl border border-white/[0.08] bg-mk-surface p-6 md:p-8">
              <div className="flex items-center gap-3">{tile}<h2 className="text-[18px] font-medium tracking-[-0.01em]">{c.whatIs(name)}</h2></div>
              <p className="mt-4 text-[14.5px] leading-relaxed text-muted-foreground">{about}</p>
            </div>
          ))}
        </div>
      </section>

      {SECTIONS.map((s) => (
        <section key={s.key} aria-labelledby={`${s.key}-title`} className="px-5 pt-14 sm:px-8 md:pt-20">
          <Reveal className={wrap}>
            <Heading id={`${s.key}-title`}>{c.sections[s.key]}</Heading>
            <div className="mt-6 md:mt-8">
              <Table title={c.sections[s.key]} them={them} rows={s.rows.map((r) => [c.rows[r], TEND[r], them.cells[r] ?? null] as [string, Cell, Cell])} />
            </div>
          </Reveal>
        </section>
      ))}

      <section aria-label={`${c.standout} · ${c.limits(them.name)}`} className="px-5 pt-14 sm:px-8 md:pt-20">
        <Reveal className={cn(wrap, "grid gap-4 md:grid-cols-2")}>
          <Card title={c.standout} items={TEND_STANDOUT} icon="check" />
          <Card title={c.limits(them.name)} items={them.limits} icon="minus" />
        </Reveal>
      </section>
      <section className="px-5 pt-4 sm:px-8">
        <Reveal className={wrap}>
          <Card title={c.ahead(them.name)} items={them.strengths} icon="check" />
        </Reveal>
      </section>

      <Weaker />

      <section aria-labelledby="bottom-title" className="px-5 pt-16 sm:px-8 md:pt-24">
        <Reveal className={wrap}>
          <Heading id="bottom-title">{c.bottom}</Heading>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {([["TEND", them.bottom.tend, <LogoTile key="t" className="size-8 rounded-lg" />], [them.name, them.bottom.them, <Tile key="x" kind={them.kind} className="size-8 rounded-lg" />]] as const).map(([title, body, tile]) => (
              <div key={title} className="rounded-2xl border border-white/[0.08] bg-mk-surface p-6 md:p-8">
                <div className="flex items-center gap-3">{tile}<h3 className="text-[17px] font-medium tracking-[-0.01em]">{title}</h3></div>
                <p className="mt-4 text-[15px] leading-relaxed text-foreground/80">{body}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      <section aria-labelledby="sources-title" className="px-5 pt-16 sm:px-8 md:pt-24">
        <Reveal className={wrap}>
          <Heading id="sources-title">{c.sources}</Heading>
          <ol className="mt-6 grid gap-2.5 text-[14px]">
            {them.sources.map(([title, href], i) => (
              <li key={href} className="flex gap-3">
                <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}.</span>
                <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-baseline gap-1 text-foreground/85 underline decoration-white/25 underline-offset-4 hover:text-foreground hover:decoration-white/60">
                  {title}<ArrowUpRightIcon className="size-3 shrink-0 self-center text-muted-foreground" aria-hidden />
                </a>
              </li>
            ))}
          </ol>
          <p className="mt-5 max-w-[64ch] text-[13.5px] text-muted-foreground">{c.sourcesNote(checked)} <Link href="/contact" className="text-foreground/85 underline decoration-white/25 underline-offset-4 hover:text-foreground">{c.report}</Link></p>
        </Reveal>
      </section>

      <section aria-labelledby="related-title" className="px-5 pt-16 sm:px-8 md:pt-24">
        <Reveal className={wrap}>
          <Heading id="related-title">{c.related}</Heading>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {c.relatedItems.map(([title, body], i) => { const href = RELATED[i]; return (
              <li key={href}>
                <Link href={href} className="group flex h-full flex-col rounded-2xl border border-white/[0.08] bg-mk-surface p-6 outline-none transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.05]">
                  <span className="flex items-center justify-between gap-3 text-[16px] font-medium tracking-[-0.01em]">{title}<ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
                  <span className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{body}</span>
                </Link>
              </li>
            ); })}
          </ul>
        </Reveal>
      </section>

      <section aria-labelledby="more-title" className="px-5 pt-16 sm:px-8 md:pt-24">
        <Reveal className={wrap}>
          <Heading id="more-title">{c.more}</Heading>
          <div className="mt-6"><CompareList items={others} label={c.more} /></div>
        </Reveal>
      </section>

      <EndBand title={c.end} accounts={accounts} secondary={{ label: c.endLink, href: "/how-it-works" }} />
    </>
  );
}
