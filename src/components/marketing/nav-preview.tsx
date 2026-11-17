"use client";

import { BookOpenIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { AppPanel } from "./kit";
import type { PreviewKey } from "./nav";
import { ShotImage, type ShotName } from "./shot";

// Loaded only when a menu opens on a desktop (nav.tsx), so the screens it shows stay out of every page's first load.
/** The real app screen (scripts/screens) shown beside the menu for each product item. */
const SHOT: Partial<Record<PreviewKey, ShotName>> = { overview: "overview", approvals: "approvals", rules: "policies", activity: "activity", agents: "agents", checks: "checks" };

/** The screen shown beside the menu for the item under the pointer: the app's own screen, or for a resource its title and line. */
export default function Preview({ k }: { k: PreviewKey }) {
  const t = useT();
  const name = SHOT[k];
  if (name) return <div aria-hidden className="h-[300px] overflow-hidden rounded-tl-xl border-t border-l border-white/[0.1] mk-shot"><div className="w-[620px]"><ShotImage name={name} alt="" sizes="620px" /></div></div>;
  const r = t.front.nav.res[k as keyof typeof t.front.nav.res];
  return (
    <AppPanel title={r[0]} icon={BookOpenIcon} bodyClassName="grid gap-2 p-4">
      <p className="text-[13px] text-muted-foreground">{r[1]}</p>
    </AppPanel>
  );
}
