"use client";

import { useMemo } from "react";
import { SignIn } from "@/components/sign-in";
import { ProtectionChecks } from "@/components/protection-checks";
import { useT } from "@/i18n/client";
import { clock } from "@/lib/format";
import { protectionOf, realAssistants } from "@/lib/home";
import { useStore } from "@/lib/store";
import { Disclosure } from "@/ui/disclosure";
import { Page, PageSkeleton } from "@/ui/page";
import { Badge, Card } from "@/ui/primitives";
import { useRunsWithReload } from "@/ui/use-runs";
import { useUiPrefs } from "@/ui/prefs-context";

/** What Tend has actually checked, per agent. A policy existing is never shown as protection. */
export default function View() {
  const t = useT();
  const g = t.verificationPage;
  const [prefs] = useUiPrefs();
  const ready = useStore((s) => s.ready);
  const status = useStore((s) => s.status);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const agents = useStore((s) => s.agents);
  const connected = useMemo(() => realAssistants(agents).filter((a) => a.origin === "connected"), [agents]);
  const { runs } = useRunsWithReload(useMemo(() => connected.map((a) => a.id), [connected]), ready && canAct);
  if (status === "signin") return <Page><SignIn compact /></Page>;
  if (!ready) return <PageSkeleton label={t.home.loading} />;
  if (!canAct) return <Page><h1 className="text-section">{g.title}</h1><p className="mt-4 text-lead text-muted-foreground">{t.tools.readOnly}</p></Page>;
  return (
    <Page full>
      <h1 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em]">{g.title}</h1>
      <p className="mt-3 max-w-[70ch] text-[15px] text-pretty text-muted-foreground">{g.sub}</p>
      <div className="mt-8 grid gap-6">
        {connected.length === 0 && <Card><p className="px-6 py-10 text-center text-[14px] text-muted-foreground">{g.none}</p></Card>}
        {connected.map((a) => {
          const run = runs.get(a.id);
          const p = protectionOf(a, run);
          const c = { verified: 0, at_risk: 0, not_verified: 0 };
          for (const k of run?.checks ?? []) c[k.status]++;
          return (
            <Card key={a.id}>
              <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-5">
                <div><h2 className="text-[17px] font-semibold">{a.name}</h2><p className="mt-1 text-[14px] text-muted-foreground">{run ? `${g.lastRun(clock(run.at))} · ${t.home.overview.counts(c.verified, c.at_risk, c.not_verified)}` : g.never}</p></div>
                <Badge tone={p.state === "attention" ? "attention" : "neutral"}>{p.state === "attention" ? t.home.overview.badge.attention : p.state === "ran" ? t.home.overview.badge.verified : t.home.overview.badge.unverified}</Badge>
              </header>
              <div className="border-t border-border px-6 pb-4"><Disclosure summary={g.show} open={prefs.details || p.state === "attention"} className="mt-1"><div className="pt-3 pb-3"><ProtectionChecks key={a.id} agentId={a.id} configVersion={a.configVersion} /></div></Disclosure></div>
            </Card>
          );
        })}
      </div>
    </Page>
  );
}
