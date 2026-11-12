"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders its children only once the block comes near the screen, so the code for a screen further down the page loads and runs
 * when someone scrolls toward it, not on the first paint. The box keeps its size meanwhile (give it one), so nothing moves when it
 * fills in. Use it for illustrations and demos, never for text a reader or a search engine needs.
 */
export function LazyMount({ children, className, margin = "600px 0px" }: { children: React.ReactNode; className?: string; margin?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      setShown(true);
      io.disconnect();
    }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return <div ref={ref} className={className}>{shown ? children : null}</div>;
}
