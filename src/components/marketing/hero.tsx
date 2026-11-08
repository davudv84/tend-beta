"use client";

import { useT } from "@/i18n/client";
import { BRAND_ICONS } from "@/lib/brand-icons";
import { INTEGRATIONS, SCENARIOS, statusOf, type IntegrationId } from "@/lib/integrations-catalog";
import { HeroDemo } from "./demo/hero-demo";
import { Container, PrimaryLink, QuietLink } from "./kit";
import { Landscape } from "./landscape";
import type { HomeImages } from "./types";

/** Verified integrations, from the catalog and the verification report; "verified" cannot be claimed from here. */
export const VERIFIED = INTEGRATIONS.filter((i) => statusOf(i) === "verified");
/** Six for the strip under the hero: these first, if verified, then any other verified one with an official mark. */
const PREFERRED: IntegrationId[] = ["claudeCode", "claude", "mcp", "langchain", "crewai", "ollama"];
const WORKS_WITH = [...PREFERRED.map((id) => VERIFIED.find((i) => i.id === id)), ...VERIFIED.filter((i) => i.logo && !PREFERRED.includes(i.id))].filter((i) => !!i).slice(0, 6);

/**
 * The top of the homepage, laid out as sim.ai's: the headline on the left, the sentence and the two buttons on the right, then the
 * app itself, clickable, in a wide frame with the dusk picture behind it, and the strip of what it works with.
 */
export function Hero({ accounts, images }: { accounts: boolean; images: HomeImages }) {
  const t = useT();
  const f = t.front;
  return (
    <section aria-labelledby="hero-title">
      <Container className="grid gap-7 pt-14 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:items-end md:gap-12 md:pt-24">
        <h1 id="hero-title" className="mk-display max-w-[13ch] text-[clamp(2.75rem,6.6vw,5.5rem)]">{f.title}</h1>
        <div className="md:pb-2">
          <p className="max-w-[40ch] text-[17px] leading-[1.45] text-foreground/80 md:text-[18px]">{f.body}</p>
          <div className="mt-6 grid gap-2.5 sm:flex sm:flex-wrap sm:items-center">
            <PrimaryLink href={accounts ? "/account/sign-up" : "/operator"} size="lg">{f.create}</PrimaryLink>
            <QuietLink href="/how-it-works" size="lg">{f.hero.howItWorks}</QuietLink>
          </div>
          <p className="mt-4 text-[13px] text-muted-foreground">{f.hero.proof(VERIFIED.length, SCENARIOS.length)}</p>
        </div>
      </Container>

      {/* The app in a frame, the picture behind it, as sim.ai shows its own workspace. */}
      <div className="mt-12 px-3 sm:px-5 md:mt-16">
        <div className="relative isolate mx-auto max-w-[1480px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#121212] px-3 pt-3 pb-3 sm:px-6 sm:pt-6 lg:px-[6%] lg:pt-[4.5%] lg:pb-[4.5%]">
          <Landscape src={images.hero} alt={f.hero.landscape} preload sizes="(max-width: 1480px) 100vw, 1480px" position="center 62%" className="-z-10" />
          <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,rgb(18_18_18/0.25),rgb(18_18_18/0.05)_40%,rgb(18_18_18/0.35))]" />
          <HeroDemo />
        </div>
      </div>

      <Container className="flex flex-col gap-6 py-10 md:flex-row md:items-center md:justify-between md:py-14">
        <p className="text-[13px] text-muted-foreground">{f.hero.worksWith}</p>
        <ul className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3 md:flex md:flex-wrap md:items-center md:gap-x-10">
          {WORKS_WITH.map((i) => (
            <li key={i.id} className="flex items-center gap-2.5 text-foreground/70">
              {i.logo && <svg aria-hidden viewBox="0 0 24 24" className="size-5 shrink-0 fill-current"><path d={BRAND_ICONS[i.logo].path} /></svg>}
              <span className="text-[15px] font-medium tracking-[-0.01em]">{i.name}</span>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
