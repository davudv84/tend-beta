"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { Page } from "@/ui/page";

/** Nothing is connected yet: one headline, one sentence, one button. Shared so every screen says it the same way. */
export function FirstRun({ title, body, sample }: { title: string; body: string; sample?: boolean }) {
  const t = useT();
  return (
    <Page bare className="grid min-h-dvh content-center justify-items-center pt-12 pb-24 text-center md:pt-12">
      <span aria-hidden className="grid size-14 place-items-center rounded-full border border-border"><span className="size-3 rounded-full bg-primary" /></span>
      <h1 className="mt-8 max-w-[16ch] text-section text-balance">{title}</h1>
      <p className="mt-4 max-w-[40ch] text-lead text-pretty text-muted-foreground">{body}</p>
      <Button asChild className="mt-10 h-12 rounded-full px-7 text-ui"><Link href="/connect">{t.home.connect}</Link></Button>
      {sample && <Link href="/labs" className="mt-6 rounded-md text-small text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{t.home.sampleLink}</Link>}
    </Page>
  );
}
