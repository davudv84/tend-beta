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
            <p className="mt-3 text-[15px] leading-relaxed text-pretty text-muted-foreground">{w.cardBody}</p>
            <Button asChild className={`${pill("light")} mt-7`}><Link href="#features">{w.cardLink}</Link></Button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/** The three outcomes, in the app's own words, drawn as a small white flow: tool call → TEND → allowed, waiting, blocked. */
function Flow() {
  const t = useT();
  const w = t.front.why;
  const s = t.home.dash.stats;
  return (
    <div role="img" aria-label={w.flow.alt} className="mk-light rounded-2xl bg-white p-5 text-[#171717] shadow-[0_30px_80px_-40px_rgb(0_0_0/0.9)] sm:p-6">
      <div aria-hidden>
        <div className="flex items-center justify-between gap-4">
          <p className="text-[15px] font-medium">{w.flow.title}</p>
          <span className="flex -space-x-1.5">
            {["#176b50", "#b45309", "#404040"].map((c) => <span key={c} className="size-5 rounded-full border-2 border-white" style={{ background: c }} />)}
          </span>
        </div>
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_28px_auto_28px_minmax(0,1.3fr)] items-center">
          <div className="rounded-xl border border-[#eaeaea] bg-[#fafafa] px-3 py-2.5">
            <p className="text-[11px] text-[#737373]">{w.flow.call}</p>
            <p className="mt-0.5 truncate font-mono text-[12px]">{INVOICE_REQUEST.tool} · {INVOICE_REQUEST.action}</p>
          </div>
          <Line />
          <span className="grid size-11 place-items-center rounded-xl bg-[#171717] text-white"><BrandMark className="size-6" /></span>
          <Fan />
          <div className="grid gap-3">
            <Badge tone="good">{s.auto}</Badge>
            <span className="relative inline-flex">
              <Badge tone="attention">{s.waiting}</Badge>
              <span className="absolute top-[14px] left-[96px] flex items-start whitespace-nowrap">
                <MousePointer2Icon className="size-4 fill-[#171717] text-[#171717]" strokeWidth={1.5} />
                <span className="-mt-0.5 ml-1 rounded-full bg-[#171717] px-2.5 py-1 text-[11px] font-medium text-white">{w.flow.bubble}</span>
              </span>
            </span>
            <Badge tone="danger">{s.blocked}</Badge>
          </div>
        </div>
        <p className="mt-8 border-t border-[#eaeaea] pt-4 text-[11px] text-[#737373]">{t.home.request.promise}</p>
      </div>
    </div>
  );
}

const Line = () => <span className="h-px w-full bg-[#d4d4d4]" />;

/** One line in, three out, with rounded corners; the stroke keeps its width however the box is sized. */
function Fan() {
  return (
    <svg viewBox="0 0 28 120" preserveAspectRatio="none" className="h-[116px] w-7">
      <path d="M0 60 H10 M10 60 V16 Q10 10 16 10 H28 M10 60 H28 M10 60 V104 Q10 110 16 110 H28" fill="none" stroke="#d4d4d4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
