"use client";

import { useEffect, useRef, useState } from "react";

type Tag = "div" | "section" | "li" | "article";

/**
 * Fades a block up once as it scrolls into view. It renders visible (so the page is complete without JavaScript and for
 * readers who prefer reduced motion); only a block that is still below the fold when the page is ready is hidden first.
 */
export function Reveal({ children, className, delay = 0, as = "div", ...rest }: { children: React.ReactNode; className?: string; delay?: number; as?: Tag } & Omit<React.HTMLAttributes<HTMLElement>, "children" | "className">) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "hidden" | "shown">("idle");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < innerHeight) return;
    setState("hidden");
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setState("shown");
      io.disconnect();
    }, { rootMargin: "0px 0px -48px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // The four tags take the same attributes; the element type only matters to the document outline.
  const Element = as as "div";
  return (
    <Element ref={ref} className={className} data-reveal={state === "idle" ? undefined : state} style={delay ? { transitionDelay: `${delay}ms` } : undefined} {...rest}>
      {children}
    </Element>
  );
}
