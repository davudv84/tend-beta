// The app's navigation entries and how one looks. Kept apart from the shell (which needs the store and the notification centre) so the
// homepage's demo sidebar can draw the same entries without loading the app.
import { ActivityIcon, CircleCheckIcon, CpuIcon, FileTextIcon, LayoutGridIcon, PlusIcon, ShieldCheckIcon, SlidersHorizontalIcon, UsersIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type NavKey = "home" | "assistants" | "approvals" | "activity" | "policies" | "verification" | "integrations" | "settings" | "access";
export type Item = { key: NavKey; href: string; icon: typeof LayoutGridIcon; match: RegExp };
const item = (key: NavKey, href: string, icon: Item["icon"], match: RegExp): Item => ({ key, href, icon, match });
// Two groups: the daily screens (what is running, what waits for you, what happened, the rules), then setup (adding an agent, checking
// what TEND can confirm). Existing addresses are kept, so nothing that links to them breaks.
export const GROUPS: { key: "daily" | "setup"; items: Item[] }[] = [
  { key: "daily", items: [item("home", "/home", LayoutGridIcon, /^\/home(\/|$)/), item("assistants", "/agents", CpuIcon, /^\/agents(\/|$)/), item("approvals", "/oversight", CircleCheckIcon, /^\/oversight(\/|$)/), item("activity", "/timeline", ActivityIcon, /^\/timeline(\/|$)/), item("policies", "/policies", FileTextIcon, /^\/policies(\/|$)/)] },
  { key: "setup", items: [item("integrations", "/connect", PlusIcon, /^\/(integrations|connect|developers)(\/|$)/), item("verification", "/verification", ShieldCheckIcon, /^\/verification(\/|$)/)] },
];
export const SETTINGS = item("settings", "/settings", SlidersHorizontalIcon, /^\/settings(\/|$)/);

export const ACCESS = item("access", "/admin/users", UsersIcon, /^\/admin(\/|$)/);

/**
 * `full`: labels always shown (the desktop sidebar and the phone drawer). Otherwise labels appear from the `lg` width up, and
 * a tablet gets the compact rail: icons only, every name still available to a screen reader and as a tooltip.
 */
export type Mode = "responsive" | "full";
export const label = (m: Mode) => (m === "full" ? "" : "sr-only lg:not-sr-only");

/** A navigation entry's look, shared with the homepage's demo sidebar, which draws the same entries as buttons. */
export const navItemClass = (active: boolean, mode: Mode) =>
  cn(
    "relative flex h-9 items-center gap-3 text-[14px] outline-none transition-colors duration-150",
    "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:bg-primary before:opacity-0 before:transition-opacity before:duration-150",
    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
    mode === "full" ? "px-5" : "justify-center px-0 lg:justify-start lg:px-5",
    active ? "bg-primary/[0.06] font-medium text-foreground before:opacity-100" : "text-muted-foreground hover:bg-black/[0.035] hover:text-foreground dark:hover:bg-white/[0.05]",
  );
export const navIconClass = (active: boolean) => cn("size-4 shrink-0 transition-colors duration-150", active && "text-primary");
export const navBadgeClass = (mode: Mode) =>
  cn("grid h-[18px] min-w-[18px] place-items-center border border-border bg-background px-1 text-[11px] font-medium text-foreground tabular-nums", mode === "full" ? "ml-auto" : "absolute top-0.5 right-0.5 lg:static lg:ml-auto");

