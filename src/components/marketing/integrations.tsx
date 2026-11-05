"use client";

import { useT } from "@/i18n/client";
import { INTEGRATIONS, SCENARIOS, statusOf } from "@/lib/integrations-catalog";
import { Eyebrow } from "./eyebrow";
import { Landscape } from "./landscape";
import { Orbit } from "./orbit";
import { Reveal } from "./reveal";
import type { HomeImages } from "./types";

// The same catalog and report as the app's Connect page; the homepage never keeps a list of its own.
const VERIFIED = INTEGRATIONS.filter((i) => statusOf(i) === "verified");
const NEXT = INTEGRATIONS.filter((i) => ["blocked", "compatible"].includes(statusOf(i)));
const PLANNED = INTEGRATIONS.filter((i) => statusOf(i) === "planned");

/** The integrations panel: the orbit on the left, the number and the words on the right, on a night landscape. */
export function Integrations({ images }: { images: HomeImages }) {
  const t = useT();
  const f = t.front.integrations;
  const names = (list: typeof INTEGRATIONS) => list.map((i) => i.name).join(", ");
  return (
    <section id="integrations" aria-labelledby="integrations-title" className="scroll-mt-24 px-6 pt-24 md:px-8 md:pt-32">
      <Reveal className="relative mx-auto max-w-[1240px] overflow-hidden rounded-3xl border border-border bg-mk-surface">
        <Landscape src={images.integrations} alt={f.landscape} tone="night" sizes="(min-width: 1280px) 1240px, 100vw" />
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(to_right,rgb(5_6_5/0.15),rgb(5_6_5/0.35)_50%,rgb(5_6_5/0.7))]" />
        <div className="relative grid gap-8 p-6 md:grid-cols-2 md:gap-10 md:p-10 lg:p-12">
          <Orbit verified={VERIFIED} next={NEXT} label={f.alt(VERIFIED.length, NEXT.length, PLANNED.length)} className="order-2 min-h-[380px] sm:min-h-[460px] md:order-1 md:min-h-[600px]" />
          <div className="order-1 flex flex-col justify-between gap-10 md:order-2">
            <div className="md:text-right">
              <p className="font-serif text-[64px] leading-none font-light tracking-[-0.02em] tabular-nums">{VERIFIED.length}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{f.count}</p>
            </div>
            <div className="max-w-[44ch]">
              <Eyebrow>{f.eyebrow}</Eyebrow>
              <h2 id="integrations-title" className="mt-5 font-serif text-[clamp(2rem,3.8vw,3rem)] leading-[1.1] font-light tracking-[-0.02em] text-balance">{f.title}</h2>
              <p className="mt-4 text-[15px] text-pretty text-foreground/80">{t.connect.choose}</p>
              <p className="mt-3 text-[12px] leading-relaxed text-pretty text-muted-foreground">{f.footnote(SCENARIOS.length)}</p>
              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-muted-foreground">
                <li className="flex items-center gap-2"><span aria-hidden className="size-2 rounded-full bg-white" />{f.legend.verified}</li>
                <li className="flex items-center gap-2"><span aria-hidden className="size-2 rounded-full bg-white/45" />{f.legend.next}</li>
                <li className="flex items-center gap-2"><span aria-hidden className="size-2 rounded-full border border-white/45" />{f.legend.planned(PLANNED.length)}</li>
              </ul>
              <dl className="sr-only">
                <dt>{f.legend.verified}</dt><dd>{names(VERIFIED)}</dd>
                <dt>{f.legend.next}</dt><dd>{names(NEXT)}</dd>
                <dt>{f.legend.planned(PLANNED.length)}</dt><dd>{names(PLANNED)}</dd>
              </dl>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
