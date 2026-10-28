"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { drawFigure } from "./actors.ts";
import { makeTarget, rgb } from "./engine.ts";

const cache = new Map<string, string>();
const noop = () => () => {};

/** The agent's pixel figure as a data URL: full figure, or head and shoulders for avatars. */
function figureURL(id: string, crop: boolean) {
  const key = `${id}:${crop}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w = 9, h = crop ? 12 : 21;
  const t = makeTarget(w, 21);
  drawFigure(t, id, "stand", false, false, 4, 19, 0, rgb(0xf3ddb0), false);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  new Uint32Array(img.data.buffer).set(t.c.subarray(0, w * h));
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

export function AgentFigure({ id, scale = 3, crop = false, className }: { id: string; scale?: number; crop?: boolean; className?: string }) {
  // Generated in the browser only (needs a canvas); the server renders a same-sized placeholder.
  const src = useSyncExternalStore(noop, () => figureURL(id, crop), () => null);
  const w = 9 * scale, h = (crop ? 12 : 21) * scale;
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- a tiny generated sprite, not a content image
    <img src={src} width={w} height={h} alt="" aria-hidden className={cn("pixelated shrink-0", className)} />
  ) : (
    <span aria-hidden className={cn("inline-block shrink-0", className)} style={{ width: w, height: h }} />
  );
}
