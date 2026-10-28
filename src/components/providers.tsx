"use client";

import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Locale } from "@/i18n/config";
import { I18nProvider } from "@/i18n/client";
import { useStore } from "@/lib/store";

/** Loads the server snapshot, then polls for new events while the tab is visible. */
export function Providers({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  useEffect(() => {
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
  }, []);

  return (
    <I18nProvider locale={locale}>
      <TooltipProvider delayDuration={150}>
        {children}
        <Toaster theme="dark" position="bottom-right" />
      </TooltipProvider>
    </I18nProvider>
  );
}
