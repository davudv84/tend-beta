"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { ActivityIcon, CircleCheckIcon, CpuIcon, FileTextIcon, LayoutGridIcon, LogOutIcon, MenuIcon, PlusIcon, ShieldCheckIcon, SlidersHorizontalIcon, UsersIcon, XIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import { LanguageSwitch } from "@/components/language-switch";
import { NotificationCenter, useNotificationPolling } from "@/components/notification-center";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n/client";
import { connectionOf, homeQueue, otherRequests, realAssistants } from "@/lib/home";
import { useNow } from "@/lib/format";
import { gatewayState, type GatewayState } from "@/lib/gateway-state";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { type ThemePref } from "@/ui/prefs";
import { useUiPrefs } from "@/ui/prefs-context";
import { BrandMark } from "@/ui/brand-mark";
import { useDocumentTheme } from "@/ui/theme";

const THEMES: ThemePref[] = ["system", "light", "dark"];
type NavKey = "home" | "assistants" | "approvals" | "activity" | "policies" | "verification" | "integrations" | "settings" | "access";
type Item = { key: NavKey; href: string; icon: typeof LayoutGridIcon; match: RegExp };
const item = (key: NavKey, href: string, icon: Item["icon"], match: RegExp): Item => ({ key, href, icon, match });
// Two groups: the daily screens (what is running, what waits for you, what happened, the rules), then setup (adding an agent, checking
// what TEND can confirm). Existing addresses are kept, so nothing that links to them breaks.
const GROUPS: { key: "daily" | "setup"; items: Item[] }[] = [
  { key: "daily", items: [item("home", "/home", LayoutGridIcon, /^\/home(\/|$)/), item("assistants", "/agents", CpuIcon, /^\/agents(\/|$)/), item("approvals", "/oversight", CircleCheckIcon, /^\/oversight(\/|$)/), item("activity", "/timeline", ActivityIcon, /^\/timeline(\/|$)/), item("policies", "/policies", FileTextIcon, /^\/policies(\/|$)/)] },
  { key: "setup", items: [item("integrations", "/connect", PlusIcon, /^\/(integrations|connect|developers)(\/|$)/), item("verification", "/verification", ShieldCheckIcon, /^\/verification(\/|$)/)] },
];
const SETTINGS = item("settings", "/settings", SlidersHorizontalIcon, /^\/settings(\/|$)/);
const ACCESS = item("access", "/admin/users", UsersIcon, /^\/admin(\/|$)/);

/** How many requests wait for this person: the one number the navigation shows. */
function useWaiting() {
  const agents = useStore((s) => s.agents);
  const authorizations = useStore((s) => s.authorizations);
  const checkIns = useStore((s) => s.checkIns);
  const requests = useStore((s) => s.requests);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const skew = useStore((s) => s.skew);
  const now = useNow() + skew;
  return useMemo(
    () => (canAct ? homeQueue(agents, authorizations, now).waiting.length + otherRequests(agents, checkIns, requests) : 0),
    [agents, authorizations, checkIns, requests, canAct, now],
  );
}

/**
 * `full`: labels always shown (the desktop sidebar and the phone drawer). Otherwise labels appear from the `lg` width up, and
 * a tablet gets the compact rail: icons only, every name still available to a screen reader and as a tooltip.
 */
type Mode = "responsive" | "full";
const label = (m: Mode) => (m === "full" ? "" : "sr-only lg:not-sr-only");

function Wordmark({ mode }: { mode: Mode }) {
  return (
    <Link href="/home" aria-label="TEND" className={cn("flex items-center gap-3 outline-none", mode === "full" ? "px-5" : "justify-center px-0 lg:justify-start lg:px-5")}>
      <BrandMark className="size-6 shrink-0 text-primary" />
      <span className={cn("text-[15px] font-semibold tracking-[0.16em]", label(mode))}>TEND</span>
    </Link>
  );
}

function NavLink({ item: it, waiting, mode }: { item: Item; waiting: number; mode: Mode }) {
  const t = useT();
  const path = usePathname();
  const active = it.match.test(path);
  const Icon = it.icon;
  const name = t.ui.nav[it.key];
  return (
    <Link
      href={it.href}
      aria-current={active ? "page" : undefined}
      title={name}
      className={cn(
        "relative flex h-9 items-center gap-3 text-[14px] outline-none transition-colors duration-150",
        "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:bg-primary before:opacity-0 before:transition-opacity before:duration-150",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
        mode === "full" ? "px-5" : "justify-center px-0 lg:justify-start lg:px-5",
        active ? "bg-primary/[0.06] font-medium text-foreground before:opacity-100" : "text-muted-foreground hover:bg-black/[0.035] hover:text-foreground dark:hover:bg-white/[0.05]",
      )}
    >
      <Icon className={cn("size-4 shrink-0 transition-colors duration-150", active && "text-primary")} strokeWidth={1.75} aria-hidden />
      <span className={label(mode)}>{name}</span>
      {it.key === "approvals" && waiting > 0 && (
        <span className={cn("grid h-[18px] min-w-[18px] place-items-center border border-border bg-background px-1 text-[11px] font-medium text-foreground tabular-nums", mode === "full" ? "ml-auto" : "absolute top-0.5 right-0.5 lg:static lg:ml-auto")}>
          <span className="sr-only">{t.ui.waitingLabel(waiting)}: </span>
          {waiting}
        </span>
      )}
    </Link>
  );
}

const MARKS: Record<GatewayState, string> = {
  connected: "rounded-full bg-primary",
  degraded: "rotate-45 bg-[#b45309]",
  disconnected: "bg-[#b42318]",
  unknown: "rounded-full border border-muted-foreground",
};

/** The gateway module: whether Tend's server is answering, from the live connection. A word, never only a colour. */
function GatewayStatus({ mode }: { mode: Mode }) {
  const t = useT();
  const g = t.ui.gateway;
  const status = useStore((s) => s.status);
  const syncedAt = useStore((s) => s.syncedAt);
  const connected = useStore((s) => realAssistants(s.agents).filter((a) => connectionOf(a, Date.now() + s.skew) === "connected").length);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const now = useNow();
  const state = gatewayState(status, syncedAt, now);
  const ago = syncedAt ? Math.max(0, Math.round((now - syncedAt) / 1000)) : null;
  const detail = state === "unknown" ? g.unknownNote : ago === null ? "" : [canAct ? g.agents(connected) : null, ago < 5 ? g.syncedNow : g.syncedAgo(ago)].filter(Boolean).join(" · ");
  return (
    <Link href="/verification" title={`${g.label}: ${g[state]}`} className={cn("mb-1 block border-t border-border py-3 outline-none transition-colors hover:bg-black/[0.035] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary dark:hover:bg-white/[0.05]", mode === "full" ? "px-5" : "px-0 lg:px-5")} aria-label={`${g.label}: ${g[state]}. ${detail}`}>
      <span className={cn("flex items-center gap-2.5", mode === "full" ? "" : "justify-center lg:justify-start")}>
        <span aria-hidden className={cn("size-2 shrink-0", MARKS[state])} />
        <span className={cn("flex min-w-0 items-baseline gap-2", label(mode))}>
          <span className="text-[13px] text-muted-foreground">{g.label}</span>
          <span className="text-[13px] font-medium">{g[state]}</span>
        </span>
      </span>
      {detail && <span className={cn("mt-1 block pl-[18px] text-[12px] text-muted-foreground", label(mode))}>{detail}</span>}
    </Link>
  );
}

/** Who is signed in, and the way out. There is one operator role today, so the card says exactly that. */
function Account({ mode }: { mode: Mode }) {
  const t = useT();
  const operator = useStore((s) => !!s.viewer?.canAct);
  const canSignIn = useStore((s) => !!s.viewer?.operatorAvailable || !!s.viewer?.accounts);
  const email = useStore((s) => s.viewer?.account?.email);
  const accounts = useStore((s) => !!s.viewer?.accounts);
  const signOut = useStore((s) => s.signOut);
  return (
    <div className={cn("flex items-center gap-1 border-t border-border py-2.5", mode === "full" ? "px-3" : "justify-center px-0 lg:justify-start lg:px-3")}>
      <Link href="/settings" title={email ?? t.ui.nav.settings} className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden px-2 py-1 outline-none focus-visible:outline-2 focus-visible:outline-primary" aria-label={`${operator ? t.ui.operator : t.ui.visitor}. ${t.ui.nav.settings}`}>
        <span aria-hidden className="grid size-7 shrink-0 place-items-center border border-border bg-background text-[11px] font-semibold">{email ? email.slice(0, 2).toUpperCase() : operator ? "OP" : "—"}</span>
        <span className={cn("min-w-0 flex-1", label(mode))}>
          <span className="block truncate text-[13px] font-medium">{email ?? (operator ? t.ui.operator : t.ui.visitor)}</span>
          <span className="block truncate text-[12px] text-muted-foreground">{operator ? t.ui.signedIn : t.ui.readOnly}</span>
        </span>
      </Link>
      {operator ? (
        <button type="button" onClick={() => void signOut()} aria-label={t.ui.signOut} title={t.ui.signOut} className={cn("grid size-8 shrink-0 place-items-center text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary", mode === "full" ? "" : "hidden lg:grid")}>
          <LogOutIcon className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      ) : canSignIn ? <Link href={accounts ? "/account/sign-in" : "/operator"} className={cn("px-2 text-[13px] font-medium text-primary hover:underline", label(mode))}>{t.ui.signIn}</Link> : null}
    </div>
  );
}

/** Beta access (approving accounts), for the admin only. */
function AdminLink({ mode }: { mode: Mode }) {
  const admin = useStore((s) => !!s.viewer?.admin && !!s.viewer?.accounts);
  return admin ? <NavLink item={ACCESS} waiting={0} mode={mode} /> : null;
}

/** Everything the sidebar holds, so the desktop sidebar, the tablet rail and the phone drawer are one thing. */
function Sidebar({ mode, waiting, container }: { mode: Mode; waiting: number; container?: HTMLElement | null }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="grid gap-6 pt-6">
        <Wordmark mode={mode} />
        <nav aria-label={t.ui.nav.label} className="grid gap-3">
          {GROUPS.map((g, i) => (
            <div key={g.key} role="group" aria-labelledby={`nav-${mode}-${g.key}`}>
              <p id={`nav-${mode}-${g.key}`} className="sr-only">{t.ui.groups[g.key]}</p>
              {i > 0 && <div aria-hidden className="mx-5 mb-3 border-t border-border" />}
              <div className="grid">{g.items.map((it) => <NavLink key={it.key} item={it} waiting={waiting} mode={mode} />)}</div>
            </div>
          ))}
        </nav>
      </div>
      {/* One column no wider than the sidebar, so a long address truncates instead of widening it. */}
      <div className="grid grid-cols-[minmax(0,1fr)]">
        <GatewayStatus mode={mode} />
        <NotificationCenter variant="nav" compact={mode !== "full"} container={container} />
        <AdminLink mode={mode} />
        <NavLink item={SETTINGS} waiting={0} mode={mode} />
        <Account mode={mode} />
      </div>
    </div>
  );
}

/** Appearance, details, language and sign-out. These change how things look, never what can be done. */
export function Preferences() {
  const t = useT();
  const [prefs, setPrefs] = useUiPrefs();
  const operator = useStore((s) => !!s.viewer?.canAct);
  const canSignIn = useStore((s) => !!s.viewer?.operatorAvailable || !!s.viewer?.accounts);
  const accounts = useStore((s) => !!s.viewer?.accounts);
  const signOut = useStore((s) => s.signOut);
  const status = useStore((s) => s.status);
  const syncedAt = useStore((s) => s.syncedAt);
  const now = useNow();
  const ago = syncedAt ? Math.max(0, Math.round((now - syncedAt) / 1000)) : null;
  return (
    <div className="grid gap-5 text-small">
      <p className="flex items-center gap-2 text-caption text-muted-foreground" role="status">
        <span aria-hidden className={cn("size-1.5 rounded-full", status === "live" ? "bg-foreground" : "border border-faint")} />
        {status === "reconnecting" ? t.shell.reconnecting : ago === null ? t.ui.connecting : ago < 5 ? t.ui.liveNow : t.ui.liveAgo(ago)}
      </p>
      <div className="grid gap-2">
        <span id="ui-appearance" className="text-caption text-faint">{t.ui.appearance.label}</span>
        <div role="radiogroup" aria-labelledby="ui-appearance" className="grid grid-cols-3 rounded-lg bg-sunken p-0.5">
          {THEMES.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={prefs.theme === v}
              onClick={() => setPrefs({ theme: v })}
              className={cn("rounded-md px-2 py-1.5 text-caption transition-colors duration-200", prefs.theme === v ? "bg-surface font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted-foreground hover:text-foreground")}
            >
              {t.ui.appearance[v]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-4">
          <span id="ui-details" className="text-foreground">{t.ui.details.label}</span>
          <Switch checked={prefs.details} onCheckedChange={(v) => setPrefs({ details: v })} aria-labelledby="ui-details" aria-describedby="ui-details-note" />
        </div>
        <p id="ui-details-note" className="text-caption text-faint">{t.ui.details.note}</p>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <LanguageSwitch />
        {!operator && canSignIn && <Link href={accounts ? "/account/sign-in" : "/operator"} className="rounded-md text-muted-foreground transition-colors hover:text-foreground">{t.ui.signIn}</Link>}
        {operator && (
          <button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-1.5 rounded-md text-muted-foreground transition-colors hover:text-foreground">
            <LogOutIcon className="size-4" strokeWidth={1.75} aria-hidden />
            {t.ui.signOut}
          </button>
        )}
      </div>
    </div>
  );
}

/** The shell: the Control Rail on a wide screen, a compact rail on a tablet, a labelled drawer on a phone. */
export function UiShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [prefs] = useUiPrefs();
  const waiting = useWaiting();
  const readOnly = useStore((s) => !!s.viewer?.readOnly);
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useDocumentTheme(prefs.theme);
  useNotificationPolling();
  // A drawer that opened on one page must not stay open on the next.
  const [seen, setSeen] = useState(path);
  if (seen !== path) { setSeen(path); setOpen(false); }

  return (
    <div ref={setRoot} className="ui-next min-h-dvh md:grid md:grid-cols-[64px_minmax(0,1fr)] lg:grid-cols-[232px_minmax(0,1fr)]" data-theme={prefs.theme}>
      <a href="#main" className="sr-only z-50 bg-surface px-3 py-2 text-small focus:not-sr-only focus:fixed focus:top-3 focus:left-3">{t.ui.skip}</a>

      <aside className="sticky top-0 hidden h-dvh min-w-0 border-r border-border bg-[#faf9f7] md:block dark:bg-sunken/50"><Sidebar mode="responsive" waiting={waiting} container={root} /></aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:hidden">
        <Link href="/home" aria-label="TEND" className="flex items-center gap-3"><BrandMark className="size-6 text-primary" /><span className="text-[15px] font-semibold tracking-[0.16em]">TEND</span></Link>
        <div className="flex items-center">
        <NotificationCenter variant="icon" container={root} />
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger aria-label={t.ui.menu} className="relative grid size-10 place-items-center text-foreground outline-none focus-visible:outline-2 focus-visible:outline-primary">
            <MenuIcon className="size-5" strokeWidth={1.75} aria-hidden />
            {waiting > 0 && <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-primary" />}
          </Dialog.Trigger>
          <Dialog.Portal container={root}>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
            <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 w-[288px] max-w-[85vw] border-r border-border bg-[#faf9f7] outline-none dark:bg-sunken">
              <Dialog.Title className="sr-only">{t.ui.menu}</Dialog.Title>
              <Dialog.Close aria-label={t.ui.closeMenu} className="absolute top-3 right-3 z-10 grid size-9 place-items-center text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"><XIcon className="size-5" strokeWidth={1.75} aria-hidden /></Dialog.Close>
              <Sidebar mode="full" waiting={waiting} container={root} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        </div>
      </header>

      <main id="main" className="min-w-0">
        {readOnly && <p role="note" className="border-b border-border bg-sunken px-4 py-2.5 text-small text-muted-foreground md:px-8">{t.common.demoBanner}</p>}
        {children}
      </main>
    </div>
  );
}
