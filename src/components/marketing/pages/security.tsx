"use client";

import { ArrowUpRightIcon, CheckIcon, MinusIcon } from "lucide-react";
import { PrimaryLink } from "../kit";
import { SITE } from "../site";
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
      <PageSection id="break" title={p.breakTitle}>
        <Panel className="border-sage/25">
          <p className="max-w-[64ch] text-[16px] leading-relaxed text-foreground/85">{p.breakBody}</p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <PrimaryLink href="/contact">{p.breakContact}</PrimaryLink>
            <a href={SITE.github} target="_blank" rel="noreferrer" className="mk-press inline-flex h-9 items-center gap-1.5 rounded-full border border-white/[0.12] px-4 text-[14px] font-medium hover:bg-white/[0.06]">{p.breakSource}<ArrowUpRightIcon className="size-3.5" strokeWidth={2} aria-hidden /></a>
          </div>
          <p className="mt-5 flex flex-wrap gap-x-6 gap-y-2"><MoreLink href="/threat-model">{t.front.footer.links.threatModel}</MoreLink></p>
        </Panel>
      </PageSection>
      <EndBand title={p.end} accounts={accounts} secondary={{ label: p.endLink, href: "/verification-report" }} />
    </>
  );
}
