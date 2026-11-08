"use client";

import { MousePointer2Icon } from "lucide-react";
import { useT } from "@/i18n/client";
import { BrandMark } from "@/ui/brand-mark";
import { Badge } from "@/ui/primitives";
import { INVOICE_REQUEST } from "./demo-data";

/** The three outcomes, in the app's own words, drawn as a small flow in the app's dark colours: tool call → TEND → allowed, waiting, blocked. */
export function Flow() {
  const t = useT();
  const w = t.front.flow;
  const s = t.home.dash.stats;
  return (
    <div role="img" aria-label={w.alt} className="dark rounded-2xl border border-white/[0.1] bg-[#131211] p-5 text-[#ede8de] shadow-[0_30px_80px_-40px_rgb(0_0_0/0.9)] sm:p-6">
      <div aria-hidden>
        <div className="flex items-center justify-between gap-4">
          <p className="text-[15px] font-medium">{w.title}</p>
          <span className="flex -space-x-1.5">
            {["#8dbba5", "#d9a55b", "#6b665d"].map((c) => <span key={c} className="size-5 rounded-full border-2 border-[#131211]" style={{ background: c }} />)}
          </span>
        </div>
        {/* On a phone the three outcomes sit under the call; from 640px up they fan out to its right. */}
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_28px_auto] items-center sm:grid-cols-[minmax(0,1fr)_28px_auto_28px_minmax(0,1.3fr)]">
          <div className="rounded-xl border border-white/[0.1] bg-[#0f0e0d] px-3 py-2.5">
            <p className="text-[11px] text-[#a9a296]">{w.call}</p>
            <p className="mt-0.5 truncate font-mono text-[12px]">{INVOICE_REQUEST.tool} · {INVOICE_REQUEST.action}</p>
          </div>
          <Line />
          <span className="grid size-11 place-items-center rounded-xl bg-[#ede8de] text-[#131211]"><BrandMark className="size-6" /></span>
          <Fan />
          <div className="col-span-3 mt-5 grid justify-items-start gap-3 border-l border-white/[0.16] pl-4 sm:col-span-1 sm:mt-0 sm:border-0 sm:pl-0">
            <Badge tone="good">{s.auto}</Badge>
            <span className="relative inline-flex">
              <Badge tone="attention">{s.waiting}</Badge>
              <span className="absolute top-[14px] left-[96px] hidden items-start whitespace-nowrap sm:flex">
                <MousePointer2Icon className="size-4 fill-white text-white" strokeWidth={1.5} />
                <span className="-mt-0.5 ml-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#171717]">{w.bubble}</span>
              </span>
            </span>
            <Badge tone="danger">{s.blocked}</Badge>
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
