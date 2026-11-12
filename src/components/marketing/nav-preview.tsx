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
import type { PreviewKey } from "./nav";

// Loaded only when a menu opens on a desktop (nav.tsx), so the app screens it shows stay out of every page's first load.
/** The live screen shown beside the menu for the item under the pointer. */
export default function Preview({ k }: { k: PreviewKey }) {
  const t = useT();
  const s = t.home.dash.stats;
  // The app's own screens at their real layout, made smaller.
  const real = k === "approvals" ? <ApprovalsPanel /> : k === "rules" ? <RulesPanel /> : k === "activity" ? <ActivityPanel /> : k === "agents" ? <AgentsPanel /> : k === "checks" ? <ChecksPanel /> : null;
  if (k === "approvals" || k === "rules" || k === "activity" || k === "agents" || k === "checks") return <Screen inner="w-[760px] [zoom:0.6]">{real}</Screen>;
  if (k === "overview") return <AppPanel title={t.ui.nav.home} icon={LayoutGridIcon} bodyClassName="p-3"><StatsGrid stats={[{ label: s.running, value: 3, note: s.of(4) }, { label: s.waiting, value: 2, note: s.now }, { label: s.auto, value: 14, note: s.day }, { label: s.blocked, value: 2, note: s.day }]} className="lg:grid-cols-2" /></AppPanel>;
  const c = t.front.kit.connect;
  return (
    <AppPanel title={t.front.nav.res[k][0]} icon={BookOpenIcon} bodyClassName="grid gap-2 p-4">
      <p className="text-[13px] text-muted-foreground">{t.front.nav.res[k][1]}</p>
      <ol className="mt-1 grid gap-1.5">{c.steps.map((s2, i) => <li key={s2} className="flex items-center gap-2.5 text-[13px]"><span className="grid size-5 place-items-center rounded-full border border-border text-[11px] tabular-nums">{i + 1}</span>{s2}</li>)}</ol>
    </AppPanel>
  );
}

