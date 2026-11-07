"use client";

import { useT } from "@/i18n/client";
import { Flow } from "../why";
import { CardGrid, EndBand, InfoCard, PageHeader, PageSection, Panel, Steps } from "../page-parts";

/** How it works: the path of one tool call, the four steps, checkpoint and gateway, and what happens when something fails. */
export function HowItWorksPage({ accounts }: { accounts: boolean }) {
  const t = useT();
  const p = t.front.pages.howItWorks;
  return (
    <>
      <PageHeader eyebrow={p.eyebrow} title={p.title} lead={p.lead}>
        <div className="mt-12 max-w-[720px] md:mt-16"><Flow /></div>
      </PageHeader>
      <PageSection id="steps" title={p.stepsTitle}><Steps items={p.steps} /></PageSection>
      <PageSection id="modes" title={p.modesTitle} lead={p.modesLead}>
        <CardGrid cols={2}>{p.modes.map(([title, body]) => <InfoCard key={title} title={title}>{body}</InfoCard>)}</CardGrid>
      </PageSection>
      <PageSection id="fails-closed" title={p.failTitle}>
        <Panel><p className="max-w-[70ch] text-[15px] leading-relaxed text-foreground/85">{p.failBody}</p></Panel>
      </PageSection>
      <EndBand title={p.end} accounts={accounts} secondary={{ label: p.endLink, href: "/security" }} />
    </>
  );
}
