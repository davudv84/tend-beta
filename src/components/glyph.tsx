import { cn } from "@/lib/utils";
import { GLYPHS, type GlyphName } from "./glyphs";

// Each row becomes runs of rects, so a glyph is a handful of elements and stays crisp at any cell size.
const runs = (rows: readonly string[]) => {
  const out: { x: number; y: number; w: number; ch: string }[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const ch = row[x];
      let w = 1;
      while (row[x + w] === ch) w++;
      if (ch !== ".") out.push({ x, y, w, ch });
      x += w;
    }
  });
  return out;
};
const CACHE = new Map<GlyphName, ReturnType<typeof runs>>();

/** A pixel glyph. `cell` is CSS pixels per glyph pixel; keep it a whole number. */
export function Glyph({ name, cell = 2, className, accent = "var(--sage)", title }: { name: GlyphName; cell?: number; className?: string; accent?: string; title?: string }) {
  const rows = GLYPHS[name];
  let r = CACHE.get(name);
  if (!r) CACHE.set(name, (r = runs(rows)));
  const w = rows[0].length, h = rows.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w * cell} height={h * cell} shapeRendering="crispEdges" className={cn("shrink-0", className)} aria-hidden={!title} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      {r.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={p.w} height={1} fill={p.ch === "+" ? accent : "currentColor"} fillOpacity={p.ch === "-" ? 0.38 : 1} />
      ))}
    </svg>
  );
}

export function Mark({ cell = 2, className }: { cell?: number; className?: string }) {
  return <Glyph name="mark" cell={cell} className={cn("text-foreground", className)} />;
}
