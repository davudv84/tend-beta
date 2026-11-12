"use client";

import { useT } from "@/i18n/client";
import { Bullets, CardGrid, EndBand, InfoCard, MoreLink, PageHeader, PageSection, Panel, Steps } from "../page-parts";

/** Docs: the guided setup from docs/connect.md, what it needs, the ways to connect, and where to read on. */
export function DocsPage({ accounts }: { accounts: boolean }) {
  const t = useT();
  const p = t.front.pages.docs;
  const l = t.front.footer.links;
  return (
    <>
      <PageHeader eyebrow={p.eyebrow} title={p.title} lead={p.lead} />
      <PageSection id="start" title={p.startTitle}><Steps items={p.start} /></PageSection>
      <PageSection id="needs" title={p.needTitle}><Panel><Bullets items={p.need} /></Panel></PageSection>
      <PageSection id="ways" title={p.waysTitle}>
        <CardGrid cols={4}>{p.ways.map(([title, body]) => <InfoCard key={title} title={title}>{body}</InfoCard>)}</CardGrid>
      </PageSection>
      <PageSection id="how-it-holds" title={p.holdsTitle} lead={p.holdsLead}>
        <div className="grid gap-4 md:grid-cols-2">
          {p.holds.map(([id, title, body]) => (
            <section key={id} id={id} aria-labelledby={`${id}-title`} className="scroll-mt-28 rounded-2xl border border-white/[0.08] bg-mk-surface p-6 target:border-sage/50">
              <h3 id={`${id}-title`} className="text-[17px] font-medium tracking-[-0.01em]"><a href={`#${id}`} className="rounded-sm hover:underline hover:underline-offset-4">{title}</a></h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-foreground/80">{body}</p>
            </section>
          ))}
        </div>
      </PageSection>
      <PageSection id="more" title={p.moreTitle}>
        <ul className="flex flex-wrap gap-x-8 gap-y-3">
          <li><MoreLink href="/how-it-works">{t.front.pages.howItWorks.meta}</MoreLink></li>
          <li><MoreLink href="/threat-model">{l.threatModel}</MoreLink></li>
          <li><MoreLink href="/verification-report">{l.report}</MoreLink></li>
          <li><MoreLink href="/security">{l.limitations}</MoreLink></li>
        </ul>
      </PageSection>
      <EndBand title={p.end} accounts={accounts} secondary={{ label: p.endLink, href: "/how-it-works" }} />
    </>
  );
}
