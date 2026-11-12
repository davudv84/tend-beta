"use client";

import { BookOpenIcon, LayoutGridIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { StatsGrid } from "@/ui/stats-grid";
import { AppPanel, Screen } from "./kit";
import { ActivityPanel } from "./panels/activity";
import { AgentsPanel } from "./panels/agents";
import { ApprovalsPanel } from "./panels/approvals";
import { ChecksPanel } from "./panels/checks";
import { RulesPanel } from "./panels/rules";
import { OVERVIEW_STATS } from "./demo-data";
import type { PreviewKey } from "./nav";

// Loaded only when a menu opens on a desktop (nav.tsx), so the app screens it shows stay out of every page's first load.
/** The live screen shown beside the menu for the item under the pointer. */
export default function Preview({ k }: { k: PreviewKey }) {
  const t = useT();
  const s = t.home.dash.stats;
  // The app's own screens at their real layout, made smaller.
  const real = k === "approvals" ? <ApprovalsPanel /> : k === "rules" ? <RulesPanel /> : k === "activity" ? <ActivityPanel /> : k === "agents" ? <AgentsPanel /> : k === "checks" ? <ChecksPanel /> : null;
  if (k === "approvals" || k === "rules" || k === "activity" || k === "agents" || k === "checks") return <Screen inner="w-[760px] [zoom:0.6]">{real}</Screen>;
  if (k === "overview") return <AppPanel title={t.ui.nav.home} icon={LayoutGridIcon} bodyClassName="p-3"><StatsGrid stats={[{ label: s.running, value: OVERVIEW_STATS.running, note: s.of(OVERVIEW_STATS.agents) }, { label: s.waiting, value: OVERVIEW_STATS.waiting, note: s.now }, { label: s.auto, value: OVERVIEW_STATS.auto, note: s.day }, { label: s.blocked, value: OVERVIEW_STATS.blocked, note: s.day }]} className="lg:grid-cols-2" /></AppPanel>;
  return (
    <AppPanel title={t.front.nav.res[k][0]} icon={BookOpenIcon} bodyClassName="grid gap-2 p-4">
      <p className="text-[13px] text-muted-foreground">{t.front.nav.res[k][1]}</p>
    </AppPanel>
  );
}

