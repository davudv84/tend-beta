"use client";

import { useEffect, useState } from "react";
import type { Runs } from "@/lib/home";
import { useStore } from "@/lib/store";

/** The latest protection checks of each assistant (operators only), loaded a few at a time and refreshed every minute. */
export function useRuns(ids: string[], enabled: boolean): Runs {
  return useRunsWithReload(ids, enabled).runs;
}

/** The same, plus a way to load them again right now (after the person has run the checks). */
export function useRunsWithReload(ids: string[], enabled: boolean): { runs: Runs; reload: () => void } {
  const getVerification = useStore((s) => s.getVerification);
  const [runs, setRuns] = useState<Runs>(new Map());
  const key = ids.join(",");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || !key) return;
    let live = true;
    const list = key.split(",");
    const load = async () => {
      const queue = [...list];
      const worker = async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          const r = await getVerification(id);
          // A failed read leaves the assistant "unknown": nothing is claimed about it.
          if (live && r.ok) setRuns((prev) => new Map(prev).set(id, r.data.run));
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    };
    void load();
    const timer = setInterval(() => !document.hidden && void load(), 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [key, enabled, getVerification, tick]);
  return { runs, reload: () => setTick((n) => n + 1) };
}
