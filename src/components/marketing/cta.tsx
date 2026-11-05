"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { Eyebrow } from "./eyebrow";
import { pill } from "./pill";
import { Reveal } from "./reveal";
import { ScreenFrame } from "./screen-frame";
import { ActivityScreen } from "./screens/activity-screen";

/** The closing card: the beta, the ask, and the Activity screen running off the card's right and bottom edges. */
export function Cta({ accounts }: { accounts: boolean }) {
  const t = useT();
  const c = t.front.cta;
  return (
    <section aria-labelledby="cta-title" className="px-6 pt-24 md:px-8 md:pt-32">
      <Reveal className="relative mx-auto max-w-[1240px] overflow-hidden rounded-3xl border border-border bg-mk-surface">
        <div aria-hidden className="pointer-events-none absolute -top-48 -left-24 size-[560px] rounded-full bg-white/[0.025]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-64 left-[30%] size-[520px] rounded-full bg-white/[0.02]" />
        <div className="relative grid gap-10 p-7 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:items-center md:gap-12 md:p-12 lg:p-14">
          <div>
            <Eyebrow>{c.eyebrow}</Eyebrow>
            <h2 id="cta-title" className="mt-6 max-w-[16ch] font-serif text-[clamp(2rem,4vw,3rem)] leading-[1.1] font-light tracking-[-0.02em] text-balance">{c.title}</h2>
            <p className="mt-4 max-w-[40ch] text-[15px] text-muted-foreground">{c.body}</p>
            <Button asChild className={`${pill("light", "lg")} mt-8`}><Link href={accounts ? "/account/sign-up" : "/operator"}>{t.front.create}</Link></Button>
          </div>
          <div className="relative -mr-7 -mb-7 md:-mr-12 md:-mb-12 lg:-mr-14 lg:-mb-14">
            <ScreenFrame label={c.screen} width={1180} height={700} address={`tend · ${t.ui.nav.activity}`} className="rounded-tr-none rounded-b-none border-r-0 border-b-0"><ActivityScreen /></ScreenFrame>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
