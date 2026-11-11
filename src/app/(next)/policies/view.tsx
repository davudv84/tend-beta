"use client";

import { useEffect, useMemo, useState } from "react";
import { Coverage, hookOf, PresetPicker } from "@/components/assistant-connect";
import { SignIn } from "@/components/sign-in";
import { ToolPermissions } from "@/components/tool-permissions";
import { useT } from "@/i18n/client";
import { presetOf } from "@/lib/agent-presets";
import { realAssistants } from "@/lib/home";
import type { PolicyView } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Page, PageSkeleton } from "@/ui/page";
import { Badge, Card, CardHeader, buttonClass } from "@/ui/primitives";

const GROUPS = [["allow", "good"], ["approve", "attention"], ["deny", "danger"]] as const;

/**
 * What each agent may do, from the policy the server holds for it. One policy per agent today. A coding assistant connected through hooks
 * (Claude Code, Cursor) is decided by its hook rules, so its page shows those (what they enforce, what they only record, what TEND can't
 * reach) and the preset picker, not the gateway tool list, which never applies to it.
 */
export default function View() {
  const t = useT();
  const g = t.policiesPage;
  const ready = useStore((s) => s.ready);
  const status = useStore((s) => s.status);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const agents = useStore((s) => s.agents);
  const getPolicy = useStore((s) => s.getPolicy);
  const connected = useMemo(() => realAssistants(agents), [agents]);
  const [picked, setPicked] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ id: string; view?: PolicyView } | null>(null);
  const [editing, setEditing] = useState(false);
  const agent = connected.find((a) => a.id === (picked ?? connected[0]?.id));
  const id = agent?.id;
  useEffect(() => {
    if (!id || !canAct) return;
    let live = true;
    void getPolicy(id).then((r) => live && setLoaded({ id, view: r.ok ? r.data : undefined }));
    return () => { live = false; };
  }, [id, canAct, getPolicy, editing]);
  // What was loaded is only used for the agent it was loaded for, so a different agent shows loading, never the last one's rules.
  const mine = loaded && loaded.id === id ? loaded : null;
  const view = mine?.view ?? null;
  const failed = !!mine && !mine.view;
  const hook = agent ? hookOf(agent) : null;
  const preset = view && view.enforcement === "enforce" ? presetOf(view.rules) : null;

  if (status === "signin") return <Page><SignIn compact /></Page>;
  if (!ready) return <PageSkeleton label={t.home.loading} />;
  if (!canAct) return <Page><h1 className="text-section">{g.title}</h1><p className="mt-4 text-lead text-muted-foreground">{t.tools.readOnly}</p></Page>;
  return (
    <Page full>
      <h1 className="text-[32px] leading-[1.15] font-medium tracking-[-0.02em]">{g.title}</h1>
      <p className="mt-3 text-[15px] text-muted-foreground">{g.sub}</p>
      {connected.length === 0 ? <Card className="mt-8"><p className="px-6 py-10 text-center text-[14px] text-muted-foreground">{g.none}</p></Card> : (
        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)]">
          <Card>
            <CardHeader title={g.all} right={g.count(connected.length)} />
            <ul className="divide-y divide-border border-t border-border">
              {connected.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => { setPicked(a.id); setEditing(false); }} aria-current={a.id === id ? "true" : undefined}
                    className={cn("block w-full px-6 py-4 text-left transition-colors hover:bg-[#fafafa]", a.id === id && "bg-[#fafafa]")}>
                    <span className={cn("block text-[15px] font-medium", a.id === id && "text-primary")}>{a.name}</span>
                    <span className="block text-[14px] text-muted-foreground">{a.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {agent && (
            <Card>
              <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
                <div className="min-w-0">
                  <h2 className="text-[20px] font-semibold tracking-[-0.01em]">{g.policyOf(agent.name)}</h2>
                  <p className="mt-1 text-[14px] text-muted-foreground">{view ? (hook ? g.hookRules(preset ? t.assistant.presets[preset].name : g.hookCustom) : view.enforcement === "enforce" ? g.enforced : g.monitored) : ""}</p>
                </div>
                <button type="button" onClick={() => setEditing((v) => !v)} className={buttonClass("secondary")}>{editing ? g.done : hook ? g.editHook : g.edit}</button>
              </header>
              {editing ? <div className="border-t border-border px-6 py-6">{hook ? <PresetPicker key={agent.id} agentId={agent.id} titled={false} onSaved={() => setEditing(false)} /> : <ToolPermissions key={agent.id} agentId={agent.id} />}</div> : failed ? <p role="alert" className="border-t border-border px-6 py-5 text-[14px] text-[#b42318]">{g.failed}</p> : !view ? <div className="border-t border-border px-6 py-8"><div aria-busy="true" className="h-24 animate-pulse rounded-lg bg-sunken" /></div> : hook ? (
                <div className="border-t border-border px-6 pb-6"><Coverage view={view} integration={hook} /></div>
              ) : (
                <>
                  {!view.valid && <p role="alert" className="border-t border-border bg-[#fff4e5] px-6 py-3 text-[14px] text-[#92400e]">{t.tools.invalid}</p>}
                  {GROUPS.map(([effect, tone]) => {
                    const rows = view.tools.filter((x) => x.effect === effect);
                    return (
                      <div key={effect} className="border-t border-border">
                        <div className="flex items-center gap-3 bg-[#fafafa] px-6 py-3"><Badge tone={tone}>{g.groups[effect].title}</Badge><span className="text-[13px] text-muted-foreground">{rows.length} · {g.groups[effect].note}</span></div>
                        {rows.length ? <ul className="divide-y divide-border">{rows.map((x) => (
                          <li key={x.tool} className="flex items-center justify-between gap-4 px-6 py-3.5">
                            <span className="min-w-0"><span className="block text-[15px]">{t.tools.names[x.tool] ?? x.tool}</span><span className="block font-mono text-[13px] text-muted-foreground">{x.tool}.{x.action}</span></span>
                            <span className="flex shrink-0 items-center gap-2 text-[13px] text-muted-foreground">{x.custom && <span className="rounded-md bg-[#f5f5f5] px-2 py-0.5">{g.custom}</span>}{t.tools.risk[x.risk]}</span>
                          </li>))}</ul> : <p className="px-6 py-4 text-[14px] text-muted-foreground">{g.empty}</p>}
                      </div>
                    );
                  })}
                  <p className="border-t border-border px-6 py-4 text-[14px] text-muted-foreground">{g.blockedNote}</p>
                </>
              )}
            </Card>
          )}
        </div>
      )}
    </Page>
  );
}
