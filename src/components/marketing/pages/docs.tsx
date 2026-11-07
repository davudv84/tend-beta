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
      <PageSection id="more" title={p.moreTitle}>
        <ul className="flex flex-wrap gap-x-8 gap-y-3">
          <li><MoreLink href="/how-it-works">{t.front.pages.howItWorks.meta}</MoreLink></li>
          <li><MoreLink href="/verification-report">{l.report}</MoreLink></li>
          <li><MoreLink href="/security">{l.limitations}</MoreLink></li>
        </ul>
      </PageSection>
      <EndBand title={p.end} accounts={accounts} secondary={{ label: p.endLink, href: "/how-it-works" }} />
    </>
  );
}
