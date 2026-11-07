"use client";

import Link from "next/link";
import { MailIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { Gap, PageHeader, Panel } from "../page-parts";
import { pill } from "../pill";
import { SITE } from "../site";

/** Contact: the address (a marked gap until site.ts has one), how to report a security problem, and how to join the beta. */
export function ContactPage({ accounts }: { accounts: boolean }) {
  const t = useT();
  const p = t.front.pages.contact;
  return (
    <>
      <PageHeader eyebrow={p.eyebrow} title={p.title} lead={p.lead} />
      <div className="mx-auto grid max-w-[1240px] gap-4 px-6 pt-12 md:grid-cols-3 md:px-8 md:pt-16">
        <Panel className="md:col-span-3">
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><MailIcon className="size-4" strokeWidth={1.75} aria-hidden />{p.email}</p>
          <p className="mt-3 font-serif text-[clamp(1.75rem,3.4vw,2.5rem)] leading-tight font-light">
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
          <Button asChild className={`${pill("light")} mt-6`}><Link href={accounts ? "/account/sign-up" : "/operator"}>{t.front.create}</Link></Button>
        </Panel>
      </div>
    </>
  );
}
