"use client";

import Link from "next/link";
import { MousePointer2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { BrandMark } from "@/ui/brand-mark";
import { Badge } from "@/ui/primitives";
import { Eyebrow } from "./eyebrow";
import { LogoTile } from "./logo";
import { pill } from "./pill";
import { Reveal } from "./reveal";
import { INVOICE_REQUEST } from "./demo-data";
import { DARK_TONE } from "./screens/dark-tones";

/** Why TEND: one wide card with the path a tool call takes on the left, and the reason in words on the right. */
export function Why() {
  const t = useT();
  const w = t.front.why;
  return (
    <section id="product" aria-labelledby="why-title" className="scroll-mt-24 px-6 pt-24 md:px-8 md:pt-32">
      <Reveal className="mx-auto max-w-[1240px] text-center">
        <Eyebrow>{w.eyebrow}</Eyebrow>
        <h2 id="why-title" className="mx-auto mt-6 max-w-[22ch] font-serif text-[clamp(2.25rem,4.6vw,3.5rem)] leading-[1.08] font-light tracking-[-0.025em] text-balance">{w.title}</h2>
      </Reveal>
      <Reveal delay={80} className="relative mx-auto mt-12 max-w-[1240px] overflow-hidden rounded-3xl border border-border bg-mk-surface md:mt-16">
        {/* Two soft discs behind the text, as a quiet depth. */}
        <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] size-[640px] rounded-full bg-white/[0.025]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-72 right-[12%] size-[560px] rounded-full bg-white/[0.02]" />
        <div className="relative grid gap-10 p-6 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:items-center md:gap-14 md:p-12">
          <Flow />
          <div className="max-w-[46ch]">
            <LogoTile className="size-9" />
            <h3 className="mt-5 text-[22px] font-medium tracking-[-0.01em]">{w.cardTitle}</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{w.cardBody}</p>
            <Button asChild className={`${pill("light")} mt-7`}><Link href="#features">{w.cardLink}</Link></Button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/** The three outcomes, in the app's own words, drawn as a small flow in the app's dark colours: tool call → TEND → allowed, waiting, blocked. */
function Flow() {
  const t = useT();
  const w = t.front.why;
  const s = t.home.dash.stats;
  return (
    <div role="img" aria-label={w.flow.alt} className="dark rounded-2xl border border-white/[0.1] bg-[#131211] p-5 text-[#ede8de] shadow-[0_30px_80px_-40px_rgb(0_0_0/0.9)] sm:p-6">
      <div aria-hidden>
        <div className="flex items-center justify-between gap-4">
          <p className="text-[15px] font-medium">{w.flow.title}</p>
          <span className="flex -space-x-1.5">
            {["#8dbba5", "#d9a55b", "#6b665d"].map((c) => <span key={c} className="size-5 rounded-full border-2 border-[#131211]" style={{ background: c }} />)}
          </span>
        </div>
        {/* On a phone the three outcomes sit under the call; from 640px up they fan out to its right. */}
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_28px_auto] items-center sm:grid-cols-[minmax(0,1fr)_28px_auto_28px_minmax(0,1.3fr)]">
          <div className="rounded-xl border border-white/[0.1] bg-[#0f0e0d] px-3 py-2.5">
            <p className="text-[11px] text-[#a9a296]">{w.flow.call}</p>
            <p className="mt-0.5 truncate font-mono text-[12px]">{INVOICE_REQUEST.tool} · {INVOICE_REQUEST.action}</p>
          </div>
          <Line />
          <span className="grid size-11 place-items-center rounded-xl bg-[#ede8de] text-[#131211]"><BrandMark className="size-6" /></span>
          <Fan />
          <div className="col-span-3 mt-5 grid justify-items-start gap-3 border-l border-white/[0.16] pl-4 sm:col-span-1 sm:mt-0 sm:border-0 sm:pl-0">
            <Badge tone="good" className={DARK_TONE.good}>{s.auto}</Badge>
            <span className="relative inline-flex">
              <Badge tone="attention" className={DARK_TONE.attention}>{s.waiting}</Badge>
              <span className="absolute top-[14px] left-[96px] hidden items-start whitespace-nowrap sm:flex">
                <MousePointer2Icon className="size-4 fill-white text-white" strokeWidth={1.5} />
                <span className="-mt-0.5 ml-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#171717]">{w.flow.bubble}</span>
              </span>
            </span>
            <Badge tone="danger" className={DARK_TONE.danger}>{s.blocked}</Badge>
          </div>
        </div>
        <p className="mt-8 border-t border-white/[0.1] pt-4 text-[11px] text-[#a9a296]">{t.home.request.promise}</p>
      </div>
    </div>
  );
}

const Line = () => <span className="h-px w-full bg-white/[0.16]" />;

/** One line in, three out, with rounded corners; the stroke keeps its width however the box is sized. */
function Fan() {
  return (
    <svg viewBox="0 0 28 120" preserveAspectRatio="none" className="hidden h-[116px] w-7 sm:block">
      <path d="M0 60 H10 M10 60 V16 Q10 10 16 10 H28 M10 60 H28 M10 60 V104 Q10 110 16 110 H28" fill="none" stroke="rgb(255 255 255 / 0.16)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
