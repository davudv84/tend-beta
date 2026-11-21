"use client";

import { useState, type ElementType, type HTMLAttributes } from "react";

/**
 * A scrollable area that a keyboard can scroll. Browsers do not put a scroll container in the tab order, so content wider than its
 * box (a table, a code block) is out of reach for someone without a pointer. When, and only when, the content really overflows, this
 * becomes a focusable, named group (not a landmark, so repeated ones never clash): arrow keys scroll it. Nothing changes visually; the focus ring appears only for keyboard focus.
 */
export function ScrollRegion({
  label,
  as,
  className,
  children,
  ...props
}: { label: string; as?: ElementType } & HTMLAttributes<HTMLElement>) {
  const Comp = as ?? "div";
  const [overflows, setOverflows] = useState(false);
  const ref = (node: HTMLElement | null) => {
    if (!node) return;
    // The observer reports once when it starts, then on every size change, so the first measurement needs no effect.
    const ro = new ResizeObserver(() => setOverflows(node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1));
    ro.observe(node);
    return () => ro.disconnect();
  };
  return (
    <Comp ref={ref} className={className} tabIndex={overflows ? 0 : undefined} role={overflows ? "group" : undefined} aria-label={overflows ? label : undefined} {...props}>
      {children}
    </Comp>
  );
}
