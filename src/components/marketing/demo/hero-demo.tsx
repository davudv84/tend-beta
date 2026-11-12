"use client";

import { useT } from "@/i18n/client";
import { DemoMobile } from "./mobile";
import { Announcer, useExactOf } from "./parts";
import { useDemo } from "./use-demo";

/**
 * The hero's interactive demo: TEND on an iPhone, at every width. One state (use-demo.ts), one request, answered once.
 */
export function HeroDemo() {
  const d = useT().front.demo;
  const demo = useDemo(useExactOf());
  return (
    <div>
      <p className="mb-5 text-center text-[13px] text-foreground/60">{d.label}</p>
      <DemoMobile demo={demo} />
      <Announcer demo={demo} />
    </div>
  );
}
