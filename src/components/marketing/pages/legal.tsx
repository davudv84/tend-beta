"use client";

import Link from "next/link";
import { useT } from "@/i18n/client";
import { Bullets, Completing, Gap, PageHeader, Prose, ProseBlock } from "../page-parts";
import { legalGaps, SITE } from "../site";

/** The provider's details from site.ts, each one a marked gap until it is filled in. */
function ProviderBlock() {
  const t = useT();
  const g = t.front.pages.legal;
  return (
    <address className="grid gap-1 not-italic">
      <span>{SITE.provider || <Gap what={g.provider} />}</span>
      {SITE.address.length ? SITE.address.map((line) => <span key={line}>{line}</span>) : <span><Gap what={g.address} /></span>}
    </address>
  );
}
const Email = () => {
  const t = useT();
  return SITE.contactEmail ? <a href={`mailto:${SITE.contactEmail}`} className="underline underline-offset-4">{SITE.contactEmail}</a> : <Gap what={t.front.pages.legal.email} />;
};

/** Imprint (Impressum): the details § 5 DDG asks for, all from site.ts. */
export function ImprintPage() {
  const t = useT();
  const p = t.front.pages.imprint;
  const g = t.front.pages.legal;
  return (
    <>
      <PageHeader eyebrow={p.eyebrow} title={p.title}>{legalGaps() && <Completing />}</PageHeader>
      <Prose>
        <ProseBlock title={p.provider}><ProviderBlock /></ProseBlock>
        <ProseBlock title={p.contact}>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2">
            <dt className="text-muted-foreground">{p.email}</dt><dd><Email /></dd>
            <dt className="text-muted-foreground">{p.phone}</dt><dd>{SITE.phone || <Gap what={g.phone} />}</dd>
            {SITE.vatId && <><dt className="text-muted-foreground">{p.vat}</dt><dd>{SITE.vatId}</dd></>}
          </dl>
        </ProseBlock>
        <ProseBlock title={p.responsible}>
          <p>{SITE.responsible || SITE.provider || <Gap what={g.responsible} />}</p>
          {SITE.address.length > 0 && <p className="text-muted-foreground">{SITE.address.join(", ")}</p>}
        </ProseBlock>
      </Prose>
    </>
  );
}

/** Privacy: what the software really stores (server/db.ts, the cookies it sets, the services it calls), with the provider's details from site.ts. */
export function PrivacyPage() {
  const t = useT();
  const p = t.front.pages.privacy;
  const g = t.front.pages.legal;
  return (
    <>
      <PageHeader eyebrow={p.eyebrow} title={p.title} lead={p.lead}>{legalGaps() && <Completing />}</PageHeader>
      <Prose>
        <ProseBlock title={p.controller}><ProviderBlock /><p><Email /></p></ProseBlock>
        <ProseBlock title={p.storedTitle}><Bullets items={p.stored} /></ProseBlock>
        <ProseBlock title={p.cookiesTitle}><Bullets items={p.cookies} /></ProseBlock>
        <ProseBlock title={p.servicesTitle}>
          <Bullets items={[...p.services, <>{p.database}: {SITE.databaseHost || <Gap what={g.databaseHost} />}</>]} />
        </ProseBlock>
        <ProseBlock title={p.basisTitle}><Bullets items={p.basis} /></ProseBlock>
        <ProseBlock title={p.keepTitle}>
          <p>{p.keep}</p>
          <p>{p.afterClose}: <Gap what={g.retention} /></p>
        </ProseBlock>
        <ProseBlock title={p.rightsTitle}>
          <p>{p.rights}</p>
          <p>{p.ask} <Email /></p>
        </ProseBlock>
      </Prose>
    </>
  );
}

/** Terms of use for the beta, in line with what the security page says TEND does and does not do. */
export function TermsPage() {
  const t = useT();
  const p = t.front.pages.terms;
  return (
    <>
      <PageHeader eyebrow={p.eyebrow} title={p.title} lead={p.lead}>{legalGaps() && <Completing />}</PageHeader>
      <Prose>
        <ProseBlock title={p.providerTitle}><ProviderBlock /><p><Email /></p></ProseBlock>
        {p.sections.map(([title, body], i) => (
          <ProseBlock key={title} title={title}>
            <p>{body}</p>
            {i === 2 && <p><Link href="/security" className="underline underline-offset-4">{t.front.footer.links.limitations}</Link></p>}
          </ProseBlock>
        ))}
        <ProseBlock title={p.lawTitle}><p>{p.law}</p></ProseBlock>
      </Prose>
    </>
  );
}
