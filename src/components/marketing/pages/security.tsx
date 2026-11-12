"use client";

import { CheckIcon, MinusIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { CardGrid, EndBand, InfoCard, MoreLink, PageHeader, PageSection, Panel } from "../page-parts";

/** Security and limitations: docs/security-limitations.md as a page, what TEND does (tested) and what it does not, in full. */
export function SecurityPage({ accounts }: { accounts: boolean }) {
  const t = useT();
  const p = t.front.pages.security;
  return (
    <>
      <PageHeader eyebrow={p.eyebrow} title={p.title} lead={p.lead} />
      <PageSection id="does" title={p.does}>
        <CardGrid>{p.doesItems.map(([title, body]) => <InfoCard key={title} label={p.does} icon={<CheckIcon className="size-3.5" strokeWidth={2} aria-hidden />} title={title}>{body}</InfoCard>)}</CardGrid>
      </PageSection>
      <PageSection id="doesnt" title={p.doesnt}>
        <CardGrid>{p.doesntItems.map(([title, body]) => <InfoCard key={title} label={p.doesnt} icon={<MinusIcon className="size-3.5" strokeWidth={2} aria-hidden />} title={title}>{body}</InfoCard>)}</CardGrid>
      </PageSection>
      <PageSection id="report" title={p.reportTitle}>
        <Panel>
          <p className="max-w-[64ch] text-[15px] leading-relaxed text-foreground/85">{p.reportBody}</p>
          <p className="mt-5"><MoreLink href="/contact">{p.reportLink}</MoreLink></p>
        </Panel>
      </PageSection>
      <EndBand title={p.end} accounts={accounts} secondary={{ label: p.endLink, href: "/verification-report" }} />
    </>
  );
}
