"use client";

import Image from "next/image";
import Link from "next/link";
import { IntegrationLogo } from "@/components/integration-logo";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { INTEGRATIONS, SCENARIOS, statusOf, type IntegrationId } from "@/lib/integrations-catalog";
import { Eyebrow } from "./eyebrow";
import { Bushes, Landscape } from "./landscape";
import { pill } from "./pill";
import { ScreenFrame } from "./screen-frame";
import { OverviewScreen } from "./screens/overview-screen";
import type { HomeImages } from "./types";

/** Verified integrations, from the catalog and the verification report; "verified" cannot be claimed from here. */
export const VERIFIED = INTEGRATIONS.filter((i) => statusOf(i) === "verified");
/** Six for the strip under the hero: these first, if verified, then any other verified one with an official mark. */
const PREFERRED: IntegrationId[] = ["claudeCode", "claude", "mcp", "langchain", "crewai", "ollama"];
/** The Overview screen's size: the app at a laptop's width, as tall as the whole page in the longer language (German). */
const SCREEN = { width: 1280, height: 2064 };
const WORKS_WITH = [...PREFERRED.map((id) => VERIFIED.find((i) => i.id === id)), ...VERIFIED.filter((i) => i.logo && !PREFERRED.includes(i.id))].filter((i) => !!i).slice(0, 6);

export function Hero({ accounts, images }: { accounts: boolean; images: HomeImages }) {
  const t = useT();
  const f = t.front;
  return (
    <section className="relative isolate overflow-hidden pt-32 pb-6 md:pt-40">
      {/* The picture sits at the bottom of the hero; the page's black runs into its sky. */}
      <Landscape src={images.hero} alt={f.hero.landscape} preload className="-z-20 top-auto h-[84%]" position="center bottom" mask="linear-gradient(to bottom, transparent, black 28%)" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,rgb(5_6_5/0.35),rgb(5_6_5/0)_35%,rgb(5_6_5/0)_70%,rgb(5_6_5/0.85)_100%)]" />

      <div className="mx-auto max-w-[1240px] px-6 text-center md:px-8">
        <Eyebrow>{f.hero.eyebrow}</Eyebrow>
        <h1 className="mx-auto mt-6 max-w-[17ch] font-serif text-[clamp(2.75rem,7.2vw,5.5rem)] leading-[1.02] font-light tracking-[-0.03em] text-balance">{f.title}</h1>
        <p className="mx-auto mt-5 max-w-[46ch] text-[16px] text-foreground/80 md:text-[17px]">{f.body}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6">
          <Button asChild className={pill("light", "lg")}><Link href={accounts ? "/account/sign-up" : "/operator"}>{f.create}</Link></Button>
          <p className="text-[13px] text-foreground/75">{f.hero.proof(VERIFIED.length, SCENARIOS.length)}</p>
        </div>
      </div>

      {/* The whole Overview page, top to bottom, above the foreground, so nothing on it is hidden. */}
      <div className="relative z-20 mx-auto mt-12 max-w-[1180px] px-4 md:mt-16 md:px-8">
        <ScreenFrame label={f.hero.screen} width={SCREEN.width} height={SCREEN.height} address={`tend · ${t.ui.nav.home}`}><OverviewScreen /></ScreenFrame>
      </div>

      <Foreground images={images} />

      <div className="relative z-20 mx-auto mt-10 flex max-w-[1240px] flex-col gap-6 px-6 md:mt-14 md:flex-row md:items-center md:justify-between md:px-8">
        <p className="max-w-[16ch] text-[13px] leading-snug text-foreground/80">{f.hero.worksWith}</p>
        <ul className="flex flex-wrap items-center gap-x-7 gap-y-3">
          {WORKS_WITH.map((i) => (
            <li key={i.id} className="flex items-center gap-2.5">
              <span className="mk-light"><IntegrationLogo entry={i} className="size-8 rounded-full" /></span>
              <span className="text-[14px] font-medium">{i.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * What overlaps the bottom of the screen: the cut-out foreground picture when it exists; until then the hero picture itself,
 * laid over the same box and masked to its lowest band, so the bushes rise over the screen pixel for pixel; without any picture,
 * drawn bushes.
 */
function Foreground({ images }: { images: HomeImages }) {
  const base = "pointer-events-none absolute inset-x-0 bottom-0 z-10";
  if (images.heroForeground) return <div aria-hidden className={`${base} h-[40%]`}><Image src={images.heroForeground} alt="" fill sizes="100vw" className="object-cover object-bottom" /></div>;
  if (images.hero) return <div aria-hidden className={`${base} h-[84%] [mask-image:linear-gradient(to_top,black_0%,black_11%,transparent_30%)]`}><Image src={images.hero} alt="" fill sizes="100vw" className="object-cover object-bottom" /></div>;
  return <div aria-hidden className={`${base} h-[28%]`}><Bushes /></div>;
}
