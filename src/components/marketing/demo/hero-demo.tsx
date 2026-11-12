"use client";

import { useT } from "@/i18n/client";
import { DemoDesktop } from "./desktop";
import { DemoMobile } from "./mobile";
import { Announcer } from "./parts";
import { useDemo } from "./use-demo";

/**
 * The hero's interactive demo: one state (use-demo.ts), one request, answered once. From 1024px up it is the app's desktop window
 * (sidebar, Overview, the approval card); below that, tablets included, it is the app on an iPhone with the Dynamic Island. Both are
 * rendered and one is hidden with CSS, so the server's markup is the first frame in the browser and nothing moves as the page loads.
 */
export function HeroDemo() {
  const d = useT().front.demo;
  const demo = useDemo();
  return (
    <div>
      {/* On the desktop the note sits in the window's title bar; on a phone, above the phone. */}
      <div className="hidden lg:block"><DemoDesktop demo={demo} /></div>
      <div className="lg:hidden">
        <p className="mb-5 text-center text-[13px] text-foreground/60">{d.label}</p>
        <DemoMobile demo={demo} />
      </div>
      <Announcer demo={demo} />
    </div>
  );
}
