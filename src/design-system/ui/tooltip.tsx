"use client";

import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";
import { usePortalContainer } from "../scope";

export const TooltipProvider = T.Provider;

/** A short hint for a control that has no visible label. Appears after a beat, vanishes at once. */
export function Tooltip({ label, shortcut, side = "top", children }: { label: string; shortcut?: string; side?: "top" | "bottom" | "left" | "right"; children: ReactNode }) {
  const container = usePortalContainer();
  return (
    <T.Root delayDuration={350}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal container={container}>
        <T.Content
          side={side}
          sideOffset={8}
          className="t-tip z-50 flex items-center gap-2 rounded-t-md bg-t-inverse px-2.5 py-1.5 text-t-caption font-medium text-t-inverse-text shadow-t-2"
        >
          {label}
          {shortcut && <kbd className="rounded-t-xs bg-white/15 px-1.5 font-mono text-[0.75rem] leading-5">{shortcut}</kbd>}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
