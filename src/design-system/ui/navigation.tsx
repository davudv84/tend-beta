"use client";

import { createContext, Fragment, useContext, useId, useState, type ReactNode } from "react";
import { LayoutGroup, motion } from "framer-motion";
import { DropdownMenu as D, Tabs as T } from "radix-ui";
import { Check, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BrandMark } from "@/ui/brand-mark";
import { cx } from "../cx";
import { useReducedMotionPref, usePortalContainer } from "../scope";
import { spring } from "../motion/tokens";
import { Button } from "./button";
import { Icon } from "./icons";

/* ---------------------------------------------------------------- Brand */

export function Wordmark({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5 text-t-ink", className)}>
      <BrandMark className={cx("size-6 text-t-accent", markClassName)} />
      <span className="text-[1.0625rem] font-semibold tracking-[0.12em]">TEND</span>
    </span>
  );
}

/* ---------------------------------------------------------------- Tabs */

const TabsCtx = createContext<{ value: string; group: string } | null>(null);

/** Tabs with an indicator that glides between triggers (a settle spring) and a panel that rises in. */
export function Tabs({
  defaultValue,
  value,
  onValueChange,
  children,
  className,
}: {
  defaultValue: string;
  value?: string;
  onValueChange?: (v: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  const group = useId();
  return (
    <TabsCtx.Provider value={{ value: current, group }}>
      <LayoutGroup id={group}>
        <T.Root
          value={current}
          onValueChange={(v) => {
            setInner(v);
            onValueChange?.(v);
          }}
          className={className}
        >
          {children}
        </T.Root>
      </LayoutGroup>
    </TabsCtx.Provider>
  );
}

export function TabsList({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <T.List aria-label={label} className={cx("flex items-center gap-1 border-b border-t-line", className)}>
      {children}
    </T.List>
  );
}

export function TabsTrigger({ value, children, count }: { value: string; children: ReactNode; count?: number }) {
  const ctx = useContext(TabsCtx);
  const reduced = useReducedMotionPref();
  const active = ctx?.value === value;
  return (
    <T.Trigger
      value={value}
      className={cx(
        "relative -mb-px inline-flex h-10 items-center gap-2 rounded-t-sm px-3 text-t-label whitespace-nowrap text-t-muted",
        "transition-colors duration-(--t-dur-fast) ease-t-out hover:text-t-ink data-[state=active]:text-t-ink",
      )}
    >
      {children}
      {count !== undefined && (
        <span className="t-num rounded-t-xs bg-t-sunken px-1.5 text-t-caption text-t-muted">{count}</span>
      )}
      {active && (
        <motion.span
          layoutId="tab-indicator"
          aria-hidden
          className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-t-accent"
          transition={reduced ? { duration: 0 } : spring.settle}
        />
      )}
    </T.Trigger>
  );
}

export function TabsContent({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <T.Content value={value} className={cx("t-panel-in outline-none", className)}>
      {children}
    </T.Content>
  );
}

/* ---------------------------------------------------------------- Breadcrumbs */

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-t-small">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={it.label}>
              <li>
                {last ? (
                  <span aria-current="page" className="font-medium text-t-ink">
                    {it.label}
                  </span>
                ) : (
                  <a
                    href={it.href ?? "#"}
                    onClick={(e) => it.href === undefined && e.preventDefault()}
                    className="rounded-t-xs text-t-muted transition-colors duration-(--t-dur-fast) hover:text-t-ink"
                  >
                    {it.label}
                  </a>
                )}
              </li>
              {!last && (
                <li aria-hidden className="text-t-subtle">
                  <Icon icon={ChevronRight} size="sm" />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---------------------------------------------------------------- Dropdown menu */

export const Dropdown = D.Root;
export const DropdownTrigger = D.Trigger;
export const DropdownRadioGroup = D.RadioGroup;

export function DropdownContent({ children, align = "start", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  const container = usePortalContainer();
  return (
    <D.Portal container={container}>
      <D.Content
        align={align}
        sideOffset={6}
        className={cx("t-menu z-50 min-w-56 rounded-t-lg border border-t-line bg-t-raised p-1 text-t-text shadow-t-2", className)}
      >
        {children}
      </D.Content>
    </D.Portal>
  );
}

const item =
  "relative flex cursor-pointer items-center gap-2.5 rounded-t-sm px-2.5 py-2 text-t-small outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-t-sunken data-[highlighted]:text-t-ink transition-colors duration-(--t-dur-instant)";

export function DropdownItem({
  icon,
  shortcut,
  danger,
  children,
  ...props
}: D.DropdownMenuItemProps & { icon?: LucideIcon; shortcut?: string; danger?: boolean }) {
  return (
    <D.Item className={cx(item, danger && "text-t-danger-ink data-[highlighted]:bg-t-danger-soft data-[highlighted]:text-t-danger-ink")} {...props}>
      {icon && <Icon icon={icon} size="md" className="shrink-0 text-t-muted" />}
      <span className="flex-1">{children}</span>
      {shortcut && <kbd className="font-mono text-[0.75rem] text-t-subtle">{shortcut}</kbd>}
    </D.Item>
  );
}

export function DropdownRadioItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <D.RadioItem value={value} className={cx(item, "pl-8")}>
      <D.ItemIndicator className="absolute left-2.5 text-t-accent-text">
        <Check size={14} strokeWidth={2.25} />
      </D.ItemIndicator>
      {children}
    </D.RadioItem>
  );
}

export const DropdownLabel = ({ children }: { children: ReactNode }) => (
  <D.Label className="px-2.5 pt-2 pb-1 text-t-caption text-t-muted">{children}</D.Label>
);
export const DropdownSeparator = () => <D.Separator className="my-1 h-px bg-t-line" />;

/* ---------------------------------------------------------------- Site header (marketing) */

export function SiteHeader({
  links,
  active,
  onNavigate,
}: {
  links: string[];
  active?: string;
  onNavigate?: (l: string) => void;
}) {
  return (
    <header className="@container flex h-[72px] items-center justify-between gap-6"><div className="flex w-full items-center justify-between gap-4">
      <div className="flex items-center gap-10">
        <Wordmark />
        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => onNavigate?.(l)}
              aria-current={active === l ? "page" : undefined}
              className={cx(
                "rounded-t-md px-3 py-2 text-t-label transition-colors duration-(--t-dur-fast) ease-t-out hover:text-t-ink",
                active === l ? "text-t-ink" : "text-t-muted",
              )}
            >
              {l}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" className="hidden sm:inline-flex">
          Sign in
        </Button>
        <Button variant="primary" trailing={ChevronRight}>
          Get started
        </Button>
      </div>
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------- Sidebar (application) */

export interface SidebarItem {
  id: string;
  label: string;
  icon: LucideIcon;
  count?: number;
}

export function AppSidebar({
  groups,
  active,
  onSelect,
  footer,
  className,
}: {
  groups: { label?: string; items: SidebarItem[] }[];
  active: string;
  onSelect: (id: string) => void;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <aside className={cx("flex flex-col gap-6 bg-t-canvas p-3", className)}>
      <div className="flex h-9 items-center px-2">
        <Wordmark markClassName="size-5" className="[&>span]:text-[0.9375rem]" />
      </div>
      <nav aria-label="Application" className="flex flex-1 flex-col gap-5">
        {groups.map((g, gi) => (
          <div key={gi} className="flex flex-col gap-0.5">
            {g.label && <p className="px-2.5 pb-1 text-t-caption text-t-muted">{g.label}</p>}
            {g.items.map((it) => {
              const on = it.id === active;
              return (
                <button
                  key={it.id}
                  type="button"
                  aria-current={on ? "page" : undefined}
                  onClick={() => onSelect(it.id)}
                  className={cx(
                    "group flex h-8 items-center gap-2.5 rounded-t-md px-2.5 text-t-small transition-colors duration-(--t-dur-fast) ease-t-out",
                    on ? "bg-t-sunken font-medium text-t-ink" : "text-t-muted hover:bg-t-sunken/70 hover:text-t-ink",
                  )}
                >
                  <Icon icon={it.icon} size="md" className={cx("shrink-0 transition-colors duration-(--t-dur-fast)", on ? "text-t-accent-text" : "text-t-subtle group-hover:text-t-muted")} />
                  <span className="flex-1 text-left">{it.label}</span>
                  {it.count !== undefined && (
                    <span className={cx("t-num rounded-t-xs px-1.5 text-t-caption", on ? "bg-t-raised text-t-ink" : "text-t-muted")}>{it.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      {footer}
    </aside>
  );
}
