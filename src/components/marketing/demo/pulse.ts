"use client";

import { useEffect, useRef, useState } from "react";

/** True for a moment after `count` changes (not when the page opens), so a number can pulse once when a request arrives. */
export function usePulse(count: number, ms = 1200) {
  const [on, setOn] = useState(false);
  const first = useRef(count);
  useEffect(() => {
    if (count === first.current) return;
    setOn(true);
    const id = window.setTimeout(() => setOn(false), ms);
    return () => clearTimeout(id);
  }, [count, ms]);
  return on;
}
