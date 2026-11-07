"use client";

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { GROUPS } from "@/lib/activity";
import { cn } from "@/lib/utils";
import { Card } from "@/ui/primitives";
import { ACTIVITY } from "../demo-data";
import { AppShell } from "./app-shell";
import { DecisionRows } from "./approvals-screen";

/** The Activity screen as the app shows it (app/(next)/timeline/view.tsx): the filters, today's decisions in the same table. */
export function ActivityScreen() {
  const t = useT();
  const g = t.timelinePage;
  return (
    <AppShell active="activity" waiting={2}>
      <div className="mx-auto w-full max-w-[1180px] px-12 pt-14 pb-24">
        <h1 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em]">{g.title}</h1>
        <p className="mt-3 max-w-[70ch] text-[15px] text-muted-foreground">{g.description}</p>
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted-foreground">
          <span className="size-1.5 rounded-full bg-sage" />
          <span className="font-medium text-foreground">{g.live}</span>
          <span>· {g.liveNote}</span>
        </p>
        <Card className="mt-8">
          <div className="flex items-center justify-between gap-4 px-6 py-4">
            <div className="inline-flex rounded-full bg-sunken p-0.5">
              {GROUPS.map((v) => (
                <span key={v} className={cn("h-8 rounded-full px-3.5 text-small leading-8 whitespace-nowrap", v === "all" ? "bg-surface font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted-foreground")}>{g.groups[v]}</span>
              ))}
            </div>
            <span className="flex h-10 w-48 items-center justify-between rounded-full border border-input px-3 text-[14px]">{t.common.allAgents}<ChevronDownIcon className="size-4 text-muted-foreground" strokeWidth={1.75} /></span>
          </div>
          <div className="border-t border-border px-6 py-2">
            <span className="-ml-1 inline-flex items-center gap-1 px-1 py-1 text-small text-muted-foreground"><ChevronRightIcon className="size-3.5" />{g.moreFilters}</span>
          </div>
          <section className="border-t border-border">
            <h2 className="bg-[#fafafa] px-6 py-2 text-[13px] font-medium text-muted-foreground dark:bg-sunken">{t.time.today}</h2>
            <DecisionRows rows={ACTIVITY} />
          </section>
        </Card>
      </div>
    </AppShell>
  );
}
