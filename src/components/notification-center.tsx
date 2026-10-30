"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BellIcon } from "lucide-react";
import { Popover } from "radix-ui";
import { useT } from "@/i18n/client";
import type { Dict } from "@/i18n";
import { timeAgo, useNow } from "@/lib/format";
import { useNotifications, type NotificationItem, type NotificationKind } from "@/lib/notifications";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Keeps the list fresh while someone who can act is signed in: on load, when new events arrive, and every 20 seconds while the tab is visible. Mount once. */
export function useNotificationPolling() {
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const seq = useStore((s) => s.seq);
  useEffect(() => {
    if (!canAct) return;
    const { refresh } = useNotifications.getState();
    void refresh();
    const id = setInterval(() => !document.hidden && void refresh(), 20_000);
    return () => clearInterval(id);
  }, [canAct]);
  // A new event may be (or resolve) a notification: look again, at most once per batch of events.
  useEffect(() => {
    if (canAct && seq) void useNotifications.getState().refresh();
  }, [canAct, seq]);
}

// The same marks as the status badges: a status is always also a word, the mark only repeats it.
const MARK: Record<NotificationKind, string> = {
  approval: "rotate-45 bg-[#b45309]",
  blocked: "bg-[#b42318]",
  alert: "bg-[#b42318]",
  failed: "bg-[#b42318]",
  expired: "rounded-full border border-muted-foreground",
  test: "rounded-full bg-primary",
};

export function notificationText(t: Dict, n: NotificationItem) {
  const k = t.notify.kinds[n.kind];
  return { title: k.title, body: k.body(n.agentName ?? t.notify.unknownAgent, n.tool ? `${n.tool} · ${n.action}` : t.notify.unknownAction) };
}

function Row({ n, now, onOpen }: { n: NotificationItem; now: number; onOpen: (n: NotificationItem) => void }) {
  const t = useT();
  const { title, body } = notificationText(t, n);
  const meta = [timeAgo(n.updatedAt, now), n.count > 1 ? t.notify.times(n.count) : null, n.kind === "approval" ? (n.resolved ? t.notify.answered : t.notify.waiting) : null].filter(Boolean).join(" · ");
  return (
    <li>
      <Link href={n.href} onClick={(e) => { e.preventDefault(); onOpen(n); }}
        className="group flex gap-3 px-4 py-3 outline-none transition-colors hover:bg-black/[0.03] focus-visible:bg-black/[0.04] dark:hover:bg-white/[0.04] dark:focus-visible:bg-white/[0.06]">
        <span aria-hidden className={cn("mt-[7px] size-2 shrink-0", MARK[n.kind])} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className={cn("text-[14px]", n.read ? "text-muted-foreground" : "font-medium text-foreground")}>{title}</span>
            {!n.read && <span className="size-1.5 shrink-0 translate-y-[-2px] rounded-full bg-primary"><span className="sr-only">{t.notify.unread}</span></span>}
          </span>
          <span className="mt-0.5 block text-[13px] text-pretty break-words text-muted-foreground">{body}</span>
          <span className="mt-1 block text-[12px] text-faint tabular-nums">{meta}</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * The bell: the unread count, and the list in a panel. Opening one marks it read (on the server, then the list is fetched again) and goes to
 * the page it is about. `nav` sits in the sidebar like a navigation row; `icon` is the phone header's button.
 */
export function NotificationCenter({ variant, compact, container }: { variant: "nav" | "icon"; compact?: boolean; container?: HTMLElement | null }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const items = useNotifications((s) => s.items);
  const unread = useNotifications((s) => s.unread);
  const loaded = useNotifications((s) => s.loaded);
  const allowed = useNotifications((s) => s.allowed);
  const markRead = useNotifications((s) => s.markRead);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const skew = useStore((s) => s.skew);
  const now = useNow() + skew;
  if (!canAct || !allowed) return null;

  const openOne = async (n: NotificationItem) => {
    setOpen(false);
    if (!n.read) void markRead([n.id]);
    router.push(n.href);
  };
  const count = unread > 99 ? "99+" : String(unread);

  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) void useNotifications.getState().refresh(); }}>
      <Popover.Trigger aria-label={t.notify.open(unread)} title={t.notify.title}
        className={cn(
          "relative outline-none focus-visible:outline-2 focus-visible:outline-primary",
          variant === "icon" ? "grid size-10 place-items-center text-foreground"
            : cn("flex h-9 w-full items-center gap-3 text-[14px] text-muted-foreground transition-colors duration-150 hover:bg-black/[0.035] hover:text-foreground focus-visible:-outline-offset-2 dark:hover:bg-white/[0.05]", compact ? "justify-center px-0 lg:justify-start lg:px-5" : "px-5", open && "bg-primary/[0.06] text-foreground"),
        )}>
        <BellIcon className={variant === "icon" ? "size-5" : "size-4 shrink-0"} strokeWidth={1.75} aria-hidden />
        {variant === "nav" && <span className={compact ? "sr-only lg:not-sr-only" : ""}>{t.notify.title}</span>}
        {unread > 0 && (
          <span aria-hidden className={cn("grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[11px] font-medium text-primary-foreground tabular-nums",
            variant === "icon" ? "absolute top-1 right-0.5" : compact ? "absolute top-0.5 right-1.5 lg:static lg:ml-auto" : "ml-auto")}>
            {count}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal container={container ?? undefined}>
        <Popover.Content side={variant === "nav" ? "right" : "bottom"} align="end" sideOffset={8} collisionPadding={12}
          className="z-50 flex max-h-[min(560px,calc(100dvh-96px))] w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-[0_12px_32px_-12px_rgb(0_0_0/0.25)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] motion-reduce:animate-none">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-[15px] font-semibold">{t.notify.title}</h2>
            <button type="button" disabled={unread === 0} onClick={() => void markRead("all")}
              className="rounded-md text-[13px] font-medium text-primary outline-none hover:underline focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:text-faint">
              {t.notify.markAll}
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
            {!loaded ? <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">{t.notify.loading}</p>
              : items.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <p className="text-[14px] font-medium">{t.notify.empty}</p>
                  <p className="mx-auto mt-1 max-w-[30ch] text-[13px] text-pretty text-muted-foreground">{t.notify.emptyBody}</p>
                </div>
              ) : <ul className="divide-y divide-border">{items.map((n) => <Row key={n.id} n={n} now={now} onOpen={openOne} />)}</ul>}
          </div>
          <footer className="border-t border-border px-4 py-2.5">
            <Link href="/settings?tab=notifications" onClick={() => setOpen(false)} className="rounded-md text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">{t.notify.settings}</Link>
          </footer>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
