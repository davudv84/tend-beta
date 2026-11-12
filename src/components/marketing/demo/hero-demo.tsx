"use client";

import { useT } from "@/i18n/client";
import { DemoDesktop } from "./desktop";
import { DemoMobile } from "./mobile";
import { Announcer, useExactOf } from "./parts";
import { useDemo } from "./use-demo";

/**
 * The hero's interactive demo: one state (use-demo.ts) shown as a desktop app window from 1024px up, and as the app on an iPhone below
 * that. Both are rendered and one is hidden with CSS, so the server's markup is the same as the first frame in the browser and nothing
 * moves when the page loads.
 */
export function HeroDemo() {
  const d = useT().front.demo;
  const demo = useDemo(useExactOf());
  return (
    <div>
      <div className="hidden lg:block"><DemoDesktop demo={demo} /></div>
      {/* On the desktop the note sits in the window's title bar; on a phone, above the phone. */}
      <div className="lg:hidden">
        <p className="mb-5 text-center text-[13px] text-white/75">{d.label}</p>
        <DemoMobile demo={demo} />
      </div>
      <Announcer demo={demo} />
    </div>
  );
}
