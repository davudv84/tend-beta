"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useStore } from "@/lib/store";

/** The public website's pages (app/page.tsx and app/(site)): no snapshot, no polling. */
const PUBLIC = ["/how-it-works", "/docs", "/threat-model", "/compare", "/changelog", "/security", "/verification-report", "/about", "/contact", "/imprint", "/privacy", "/terms"];
const isPublicSite = (p: string) => p === "/" || p.startsWith("/product/") || PUBLIC.includes(p);

/** Loads the server snapshot, then polls for new events while the tab is visible. */
export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  useEffect(() => {
    // The public site shows no live data: it takes no snapshot and polls nothing.
    if (isPublicSite(pathname)) return;
    const { init, poll } = useStore.getState();
    void init();
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (!document.hidden) await poll();
      // Back off while the server is unreachable.
      timer = setTimeout(loop, useStore.getState().status === "reconnecting" ? 6000 : 2500);
    };
    timer = setTimeout(loop, 2500);
    const wake = () => !document.hidden && void poll();
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [pathname]);

  return (
    <TooltipProvider delayDuration={150}>
      {children}
      <Toaster theme="dark" position="bottom-right" />
    </TooltipProvider>
  );
}
