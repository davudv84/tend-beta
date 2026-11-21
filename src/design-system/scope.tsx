"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ComponentProps } from "react";
import { useReducedMotion } from "framer-motion";
import { cx } from "./cx";

export type ThemeName = "light" | "dark";
export type Density = "app" | "marketing";

interface ScopeValue {
  theme: ThemeName;
  /** Where Radix portals mount, so overlays inherit the scope's tokens instead of falling back to <body>. */
  container: HTMLElement | null;
  forceReduced: boolean;
}
const ScopeContext = createContext<ScopeValue>({ theme: "light", container: null, forceReduced: false });

export const useScope = () => useContext(ScopeContext);
export const usePortalContainer = () => useScope().container ?? undefined;

/** True when motion should be skipped: the system asks for it, or the showcase's own switch is on. */
export function useReducedMotionPref() {
  const system = useReducedMotion();
  const { forceReduced } = useScope();
  return Boolean(system) || forceReduced;
}

/**
 * A design-system scope: sets the theme, density and motion mode for everything inside it and tells overlays where to mount.
 * The first scope on a page is the root; nested ones (a dark specimen on a light page) are previews.
 */
export function Scope({
  theme,
  density = "app",
  reducedMotion,
  className,
  children,
  ...props
}: { theme: ThemeName; density?: Density; reducedMotion?: boolean } & Omit<ComponentProps<"div">, "ref">) {
  const parent = useScope();
  const [el, setEl] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => setEl(node), []);
  const forceReduced = reducedMotion ?? parent.forceReduced;
  const value = useMemo(() => ({ theme, container: el, forceReduced }), [theme, el, forceReduced]);
  return (
    <div
      ref={ref}
      className={cx("tds", className)}
      data-theme={theme}
      data-density={density}
      data-motion={forceReduced ? "reduced" : undefined}
      {...props}
    >
      <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
    </div>
  );
}
