import { BotIcon, BoxesIcon, CpuIcon, PlugIcon } from "lucide-react";
import { BRAND_ICONS } from "@/lib/brand-icons";
import type { Integration, IntegrationCategory } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";

// No official mark: a neutral glyph for the category, never a made-up logo or letters.
const FALLBACK: Record<IntegrationCategory, typeof BotIcon> = { provider: CpuIcon, agent: BotIcon, framework: BoxesIcon, protocol: PlugIcon };

/** The product's official mark in one color, on a quiet tile. Decorative: the name is always written next to it. */
export function IntegrationLogo({ entry, className }: { entry: Pick<Integration, "logo" | "category">; className?: string }) {
  const Glyph = FALLBACK[entry.category];
  return (
    <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-background", className)}>
      {entry.logo
        ? <svg viewBox="0 0 24 24" className="size-[55%] fill-foreground"><path d={BRAND_ICONS[entry.logo].path} /></svg>
        : <Glyph className="size-[50%] text-faint" strokeWidth={1.75} />}
    </span>
  );
}
