"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { Eyebrow } from "./eyebrow";
import { pill } from "./pill";
import { Reveal } from "./reveal";
import { ScreenFrame } from "./screen-frame";
import { ActivityScreen } from "./screens/activity-screen";

/** The closing card: the beta and the ask on top, and under them the whole Activity screen across the card, large enough to read. */
export function Cta({ accounts }: { accounts: boolean }) {
  const t = useT();
  const c = t.front.cta;
  return (
    <section aria-labelledby="cta-title" className="px-6 pt-24 md:px-8 md:pt-32">
      <Reveal className="relative mx-auto max-w-[1240px] overflow-hidden rounded-3xl border border-border bg-mk-surface">
        <div aria-hidden className="pointer-events-none absolute -top-48 -left-24 size-[560px] rounded-full bg-white/[0.025]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-64 left-[30%] size-[520px] rounded-full bg-white/[0.02]" />
        <div className="relative p-5 pt-7 sm:p-7 md:p-12 lg:p-14">
          <div className="flex flex-col gap-6 px-2 sm:px-0 md:flex-row md:items-end md:justify-between md:gap-12">
            <div>
              <Eyebrow>{c.eyebrow}</Eyebrow>
              <h2 id="cta-title" className="mt-6 max-w-[16ch] font-serif text-[clamp(2rem,4vw,3rem)] leading-[1.1] font-light tracking-[-0.02em] text-balance">{c.title}</h2>
            </div>
            <div className="md:max-w-[38ch] md:pb-1">
              <p className="text-[15px] text-muted-foreground">{c.body}</p>
              <Button asChild className={`${pill("light", "lg")} mt-6`}><Link href={accounts ? "/account/sign-up" : "/operator"}>{t.front.create}</Link></Button>
            </div>
          </div>
          <ScreenFrame label={c.screen} width={1728} height={SCREEN_HEIGHT} address={`tend · ${t.ui.nav.activity}`} className="mt-10 md:mt-14"><ActivityScreen /></ScreenFrame>
        </div>
      </Reveal>
    </section>
  );
}

/** The Activity page's whole height in a 1728px-wide window, as in the hero, with room for the longer German words. */
const SCREEN_HEIGHT = 964;
