"use client";

import { useT } from "@/i18n/client";
import { LogoTile } from "../logo";
import { CardGrid, EndBand, InfoCard, PageHeader } from "../page-parts";

/** About: what TEND is, how it is built, where it stands and where it is made. */
export function AboutPage({ accounts }: { accounts: boolean }) {
  const t = useT();
  const p = t.front.pages.about;
  return (
    <>
      <PageHeader eyebrow={p.eyebrow} title={p.title} lead={p.lead}><LogoTile className="mt-10 size-14" /></PageHeader>
      <div className="mx-auto max-w-[1200px] px-5 pt-12 sm:px-8 md:pt-16">
        <CardGrid cols={2}>{p.sections.map(([title, body]) => <InfoCard key={title} title={title} className="md:min-h-[180px]">{body}</InfoCard>)}</CardGrid>
      </div>
      <EndBand title={p.end} accounts={accounts} secondary={{ label: p.endLink, href: "/contact" }} />
    </>
  );
}
