"use client";

import { MailIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { Gap, PageHeader, Panel } from "../page-parts";
import { PrimaryLink } from "../kit";
import { SITE } from "../site";

/** Contact: the address (a marked gap until site.ts has one), how to report a security problem, and how to join the beta. */
export function ContactPage({ accounts }: { accounts: boolean }) {
  const t = useT();
  const p = t.front.pages.contact;
  return (
    <>
      <PageHeader eyebrow={p.eyebrow} title={p.title} lead={p.lead} />
      <div className="mx-auto grid max-w-[1200px] gap-4 px-5 pt-12 sm:px-8 md:grid-cols-3 md:pt-16">
        <Panel className="md:col-span-3">
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><MailIcon className="size-4" strokeWidth={1.75} aria-hidden />{p.email}</p>
          <p className="mt-3 mk-heading text-[clamp(1.75rem,3.4vw,2.5rem)]">
            {SITE.contactEmail ? <a href={`mailto:${SITE.contactEmail}`} className="underline-offset-4 hover:underline">{SITE.contactEmail}</a> : <Gap what={p.emailGap} />}
          </p>
        </Panel>
        <Panel className="md:col-span-2">
          <h2 className="text-[20px] font-medium tracking-[-0.01em]">{p.securityTitle}</h2>
          <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">{p.securityBody}</p>
        </Panel>
        <Panel>
          <h2 className="text-[20px] font-medium tracking-[-0.01em]">{p.betaTitle}</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{p.betaBody}</p>
          <PrimaryLink href={accounts ? "/account/sign-up" : "/operator"} className="mt-6">{t.front.create}</PrimaryLink>
        </Panel>
      </div>
    </>
  );
}
