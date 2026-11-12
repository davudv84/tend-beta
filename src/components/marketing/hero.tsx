"use client";

import { useT } from "@/i18n/client";
import { INTEGRATIONS, statusOf } from "@/lib/integrations-catalog";
import { DemoButton } from "@/ui/demo-button";
import { HeroDemo } from "./demo/hero-demo";
import { Container, PrimaryLink, QuietLink } from "./kit";
import { HeroPainting } from "./landscape";

/** Verified integrations, from the catalog and the verification report; "verified" cannot be claimed from here. */
export const VERIFIED = INTEGRATIONS.filter((i) => statusOf(i) === "verified");

/**
 * The top of the homepage: one line, one sentence, two buttons, and TEND's signature, the app on an iPhone with its approval
 * notification, standing in the bright gap of the painted valley. The painting is darkened at export and fades to the page in its
 * bottom third, so the phone stays the thing to look at. The phone's size is fixed per breakpoint, so nothing moves as it loads.
 */
export function Hero({ accounts, demo }: { accounts: boolean; demo: boolean }) {
  const t = useT();
  const f = t.front;
  const create = accounts ? "/account/sign-up" : "/operator";
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <HeroPainting alt={f.art.valley} />
      <Container className="flex flex-col items-center pt-14 pb-12 text-center md:pt-20 md:pb-14">
        <h1 id="hero-title" className="mk-display max-w-[16ch] text-[clamp(2.6rem,6.4vw,5.25rem)]">{f.title}</h1>
        <p className="mt-5 max-w-[44ch] text-[17px] leading-[1.45] text-foreground/80 md:text-[19px]">{f.body}</p>
        <div className="mt-8 grid w-full max-w-[360px] gap-2.5 sm:flex sm:w-auto sm:max-w-none sm:justify-center">
          {/* With the demo set up, it leads: one click, read-only, nothing to sign up for. */}
          {demo ? <DemoButton note={false} /> : <PrimaryLink href={create} size="lg">{f.create}</PrimaryLink>}
          {demo ? <QuietLink href={create} size="lg" className="bg-[#181818]/40 backdrop-blur-sm">{f.create}</QuietLink> : <QuietLink href="/how-it-works" size="lg" className="bg-[#181818]/40 backdrop-blur-sm">{f.hero.howItWorks}</QuietLink>}
        </div>
        {demo && <p className="mt-3 text-[13px] text-foreground/60">{f.liveDemoNote}</p>}
      </Container>
      {/* The desktop window is wider than the text column; the phone is centred in it. */}
      <div className="mx-auto w-full max-w-[1320px] px-5 pb-16 text-left sm:px-8 md:pb-24"><HeroDemo /></div>
    </section>
  );
}
