"use client";

import { ActivityIcon, BellIcon, CircleCheckIcon, CpuIcon, FileTextIcon, LayoutGridIcon, PlusIcon, ShieldCheckIcon, SlidersHorizontalIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/ui/brand-mark";

type NavKey = "home" | "assistants" | "approvals" | "activity" | "policies" | "verification" | "integrations";
type Icon = typeof LayoutGridIcon;
const DAILY: [NavKey, Icon][] = [["home", LayoutGridIcon], ["assistants", CpuIcon], ["approvals", CircleCheckIcon], ["activity", ActivityIcon], ["policies", FileTextIcon]];
const SETUP: [NavKey, Icon][] = [["integrations", PlusIcon], ["verification", ShieldCheckIcon]];

/**
 * A still copy of the app's shell (ui/shell.tsx): the same sidebar with the same words, and nothing live behind it. The app's own
 * components render the content. Shown inside ScreenFrame, so it is decorative and inert. Dark by default, as the app looks when a
 * person has chosen dark: the `dark` class turns on the components' `dark:` styles, `data-theme` the app's dark tokens (globals.css).
 */
export function AppShell({ active, waiting = 0, online = 2, theme = "dark", children }: { active: NavKey; waiting?: number; online?: number; theme?: "dark" | "light"; children: React.ReactNode }) {
  const t = useT();
  const g = t.ui.gateway;
  const item = (key: NavKey | "settings", Icon: Icon) => {
    const on = key === active;
    return (
      <span key={key} className={cn("relative flex h-9 items-center gap-3 px-5 text-[14px]", "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:bg-primary", on ? "bg-primary/[0.06] font-medium text-foreground" : "text-muted-foreground before:opacity-0")}>
        <Icon className={cn("size-4 shrink-0", on && "text-primary")} strokeWidth={1.75} />
        <span>{t.ui.nav[key]}</span>
        {key === "approvals" && waiting > 0 && <span className="ml-auto grid h-[18px] min-w-[18px] place-items-center border border-border bg-background px-1 text-[11px] font-medium text-foreground tabular-nums">{waiting}</span>}
      </span>
    );
  };
  return (
    <div className={cn("ui-next grid h-full min-h-full grid-cols-[232px_minmax(0,1fr)]", theme === "dark" && "dark")} data-theme={theme}>
      <aside className="flex min-w-0 flex-col justify-between border-r border-border bg-[#faf9f7] dark:bg-sunken/50">
        <div className="grid gap-6 pt-6">
          <span className="flex items-center gap-3 px-5"><BrandMark className="size-6 shrink-0 text-primary" /><span className="text-[15px] font-semibold tracking-[0.16em]">TEND</span></span>
          <div className="grid gap-3">
            <div className="grid">{DAILY.map(([k, I]) => item(k, I))}</div>
            <div><div className="mx-5 mb-3 border-t border-border" /><div className="grid">{SETUP.map(([k, I]) => item(k, I))}</div></div>
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)]">
          <span className="mb-1 block border-t border-border px-5 py-3">
            <span className="flex items-center gap-2.5">
              <span className="size-2 shrink-0 rounded-full bg-primary" />
              <span className="flex min-w-0 items-baseline gap-2"><span className="text-[13px] text-muted-foreground">{g.label}</span><span className="text-[13px] font-medium">{g.connected}</span></span>
            </span>
            <span className="mt-1 block pl-[18px] text-[12px] text-muted-foreground">{g.agents(online)} · {g.syncedNow}</span>
          </span>
          <span className="flex h-9 items-center gap-3 px-5 text-[14px] text-muted-foreground"><BellIcon className="size-4 shrink-0" strokeWidth={1.75} /><span>{t.ui.nav.notifications}</span></span>
          {item("settings", SlidersHorizontalIcon)}
          <span className="flex items-center gap-1 border-t border-border px-3 py-2.5">
            <span className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1">
              <span className="grid size-7 shrink-0 place-items-center border border-border bg-background text-[11px] font-semibold">OP</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{t.ui.operator}</span><span className="block truncate text-[12px] text-muted-foreground">{t.ui.signedIn}</span></span>
            </span>
          </span>
        </div>
      </aside>
      <div className="min-w-0 bg-background">{children}</div>
    </div>
  );
}
