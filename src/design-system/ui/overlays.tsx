"use client";

import { Dialog as D, Popover as P } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { usePortalContainer } from "../scope";
import { IconButton } from "./button";

/* ---------------------------------------------------------------- Dialog */

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

function Scrim() {
  return <D.Overlay className="t-scrim fixed inset-0 z-50 bg-t-scrim backdrop-blur-[2px]" />;
}

/** Focused, interruptive: one decision. Title and description are required, so it always has an accessible name. */
export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const container = usePortalContainer();
  return (
    <D.Portal container={container}>
      <Scrim />
      <D.Content
        className={cx(
          "t-dialog fixed top-1/2 left-1/2 z-50 flex max-h-[min(40rem,calc(100dvh-2rem))] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-t-xl border border-t-line bg-t-raised shadow-t-3",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 p-6 pb-0">
          <div className="flex flex-col gap-1.5">
            <D.Title className="text-t-h3 text-t-ink">{title}</D.Title>
            <D.Description className="text-t-small text-t-muted">{description}</D.Description>
          </div>
          <D.Close asChild>
            <IconButton icon={X} label="Close" size="sm" tooltip={false} className="-mt-1 -mr-2" />
          </D.Close>
        </div>
        {children && <div className="t-scroll overflow-y-auto px-6 py-5">{children}</div>}
        {footer && <div className="flex items-center justify-end gap-2 border-t border-t-line px-6 py-4">{footer}</div>}
      </D.Content>
    </D.Portal>
  );
}

/* ---------------------------------------------------------------- Drawer */

export const Drawer = D.Root;
export const DrawerTrigger = D.Trigger;
export const DrawerClose = D.Close;

/** A side panel for work that continues the page behind it: reviewing a request, editing a policy. */
export function DrawerContent({ title, description, children, footer }: { title: string; description: string; children?: ReactNode; footer?: ReactNode }) {
  const container = usePortalContainer();
  return (
    <D.Portal container={container}>
      <Scrim />
      <D.Content className="t-drawer fixed inset-y-0 right-0 z-50 flex w-[min(28rem,100vw)] flex-col border-l border-t-line bg-t-raised shadow-t-3">
        <div className="flex items-start justify-between gap-4 border-b border-t-line p-6">
          <div className="flex flex-col gap-1.5">
            <D.Title className="text-t-h3 text-t-ink">{title}</D.Title>
            <D.Description className="text-t-small text-t-muted">{description}</D.Description>
          </div>
          <D.Close asChild>
            <IconButton icon={X} label="Close" size="sm" tooltip={false} className="-mt-1 -mr-2" />
          </D.Close>
        </div>
        <div className="t-scroll flex-1 overflow-y-auto p-6">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-t-line px-6 py-4">{footer}</div>}
      </D.Content>
    </D.Portal>
  );
}

/* ---------------------------------------------------------------- Popover */

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;

/** Anchored, non-modal: extra detail or a small form beside the thing that asked for it. */
export function PopoverContent({ children, className, align = "start" }: { children: ReactNode; className?: string; align?: "start" | "center" | "end" }) {
  const container = usePortalContainer();
  return (
    <P.Portal container={container}>
      <P.Content align={align} sideOffset={8} className={cx("t-menu z-50 w-80 rounded-t-lg border border-t-line bg-t-raised p-4 text-t-text shadow-t-2", className)}>
        {children}
      </P.Content>
    </P.Portal>
  );
}
