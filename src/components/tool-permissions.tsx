"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n/error-text";
import { applyChoices, choiceOf, type Choice, type Effect, type PolicyView, type RuleLike } from "@/lib/permissions";
import { call, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Disclosure } from "@/ui/disclosure";

const CHOICES: Choice[] = ["allow", "ask", "never"];

/**
 * What a connected agent may do, one row per gateway tool. It shows what the server reports it would decide, and after
 * every save it asks the server again and shows that, so the screen cannot drift from the saved policy. Nothing here is
 * trusted: the server validates the rules and refuses to let a spending tool run without approval.
 */
/** A tool name TEND accepts (policy.ts ID). */
const TOOL_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

/** What POST /api/v1/policy-simulations answers (src/server/simulate.ts). */
interface Simulation { actions: number; would: Record<Effect, number>; changes: Record<string, number>; examples: { id: string; tool: string; action: string; resource: string | null; was: Effect; would: Effect }[] }

export function ToolPermissions({ agentId, suggest, onView }: {
  agentId: string;
  /** Tools to pre-select as "Ask me first" on first load, if they are blocked. Nothing is saved until the person saves. Pass a constant array. */
  suggest?: string[];
  /** Told what the server reports after every load and save. Pass a stable function. */
  onView?: (view: PolicyView) => void;
}) {
  const t = useT();
  const p = t.tools;
  const getPolicy = useStore((s) => s.getPolicy);
  const savePolicy = useStore((s) => s.savePolicy);
  const [view, setView] = useState<PolicyView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [extra, setExtra] = useState<string[]>([]); // own tools added here, not saved yet
  const [newTool, setNewTool] = useState("");
  const [json, setJson] = useState<string | null>(null); // the advanced editor's text, once opened
  const first = useRef(true);

  /** Shows what the server answered: the policy, or why there is none. Returns the policy so a caller can compare it. */
  const apply = useCallback((r: Awaited<ReturnType<typeof getPolicy>>) => {
    if (!r.ok) return setFailed(errorText(t, r)), null;
    setFailed(null);
    setView(r.data);
    setDraft(first.current && suggest
      ? Object.fromEntries(suggest.filter((tool) => r.data.tools.some((x) => x.tool === tool && !x.custom && x.effect === "deny")).map((tool) => [tool, "ask" as Choice]))
      : {});
    first.current = false;
    onView?.(r.data);
    return r.data;
  }, [t, suggest, onView]);

  // The parent keys this component by agent, so a different agent starts from a clean state.
  useEffect(() => {
    let live = true;
    void getPolicy(agentId).then((r) => live && apply(r));
    return () => {
      live = false;
    };
  }, [agentId, getPolicy, apply]);

  if (failed)
    return (
      <div className="grid justify-items-start gap-3">
        <p role="alert" className="text-small text-destructive">{p.loadFailed} {failed}</p>
        <Button variant="outline" size="sm" onClick={async () => apply(await getPolicy(agentId))}>{p.retry}</Button>
      </div>
    );
  if (!view) return <p className="text-small text-faint">{p.loading}</p>;

  // A custom rule is editable here when it is a plain rule (no resource prefix, no permission): one tool, one action, one effect.
  const plainRule = (tool: string, action: string) => view.rules.some((r) => r.tool === tool && r.action === action && r.resourcePrefix === undefined && r.permission === undefined && r.when === undefined)
    && !view.rules.some((r) => r.tool === tool && r.when !== undefined); // a tool with conditional rules is edited through the API, not here
  const rows = [...view.tools, ...extra.filter((tool) => !view.tools.some((x) => x.tool === tool)).map((tool) => ({ tool, action: "call", risk: "write" as const, available: true, effect: "deny" as Effect, custom: true, added: true }))];
  const editable = (r: (typeof rows)[number]) => !r.custom || ("added" in r && r.added) || plainRule(r.tool, r.action);
  const current = (tool: string) => draft[tool] ?? choiceOf(rows.find((r) => r.tool === tool)!.effect);
  const changes = rows.filter((r) => editable(r) && draft[r.tool] !== undefined && (draft[r.tool] !== choiceOf(r.effect) || ("added" in r && r.added)));
  const pick = (tool: string, c: Choice) => (setNotice(null), setSim(null), setDraft((d) => ({ ...d, [tool]: c })));
  const askAll = () => (setNotice(null), setSim(null), setDraft(Object.fromEntries(rows.filter(editable).map((r) => [r.tool, "ask" as Choice]))));
  const addTool = (e: React.FormEvent) => {
    e.preventDefault();
    const tool = newTool.trim();
    if (!TOOL_ID.test(tool) || rows.some((r) => r.tool === tool)) return;
    setExtra((x) => [...x, tool]);
    setDraft((d) => ({ ...d, [tool]: "ask" }));
    setNewTool("");
    setSim(null);
  };
  const proposed = () => applyChoices(view.rules, changes.map((c) => ({ tool: c.tool, action: c.action, choice: draft[c.tool] })));

  // Replays this agent's recorded requests through the draft, on the server, read-only. Nothing runs and nothing is saved.
  const preview = async () => {
    setBusy(true);
    const r = await call<Simulation>("/api/v1/policy-simulations", { agentId, rules: proposed() });
    setBusy(false);
    if (!r.ok) return toast.error(p.simFailed, { description: errorText(t, r) });
    setSim(r.data);
  };

  // The whole rule list as JSON: the only place conditions on arguments ("when") are edited. The server validates it like any other save.
  const saveJson = async () => {
    let rules: unknown;
    try { rules = JSON.parse(json ?? ""); } catch { return toast.error(p.jsonInvalid); }
    setBusy(true);
    // Sent as typed: the server, not this page, decides whether the rules are valid.
    const r = await savePolicy(agentId, { rules: rules as RuleLike[], expectedVersion: view.version });
    const fresh = apply(await getPolicy(agentId));
    setBusy(false);
    if (!r.ok) return toast.error(errorText(t, r));
    setJson(fresh ? JSON.stringify(fresh.rules, null, 2) : null);
    setNotice(p.saved);
  };

  const save = async () => {
    setBusy(true);
    const r = await savePolicy(agentId, { rules: proposed(), expectedVersion: view.version });
    setSim(null);
    if (r.ok) setExtra([]);
    // Whatever happened, show what the server has now.
    const fresh = apply(await getPolicy(agentId));
    setBusy(false);
    if (!r.ok) return toast.error(errorText(t, r));
    const kept = rows.filter((x) => editable(x) && fresh && fresh.tools.some((y) => y.tool === x.tool) && draft[x.tool] !== undefined && choiceOf(fresh.tools.find((y) => y.tool === x.tool)!.effect) !== draft[x.tool]);
    setNotice(kept.length ? p.stricter(kept.map((x) => p.names[x.tool] ?? x.tool).join(", ")) : p.saved);
  };

  return (
    <div className="grid gap-4">
      <p className="text-small text-muted-foreground">{p.intro}</p>
      {!view.valid && <p role="alert" className="text-small text-amber">{p.invalid}</p>}
      <ul className="divide-y divide-border border-y border-border">
        {rows.map((r) => {
          const name = p.names[r.tool] ?? r.tool;
          const spend = r.risk === "spend";
          return (
            <li key={r.tool} className="grid gap-2 py-3">
              <div>
                <span className="text-sm font-medium">{name}</span>
                <span className="ml-2 text-caption text-faint">{p.risk[r.risk]}</span>
              </div>
              {!editable(r) ? (
                <p className="text-small text-muted-foreground">{p.custom}</p>
              ) : (
                <div role="radiogroup" aria-label={p.groupLabel(name)} className="flex flex-wrap gap-2">
                  {CHOICES.map((c) => {
                    const locked = spend && c === "allow";
                    const on = current(r.tool) === c;
                    return (
                      <Button
                        key={c}
                        role="radio"
                        aria-checked={on}
                        variant={on ? "default" : "outline"}
                        size="sm"
                        disabled={busy || locked}
                        className={cn(locked && "opacity-50")}
                        onClick={() => pick(r.tool, c)}
                      >
                        {p.choice[c]}
                      </Button>
                    );
                  })}
                </div>
              )}
              {spend && <p className="flex items-center gap-1.5 text-caption text-faint"><LockIcon className="size-3" /> {p.spendLocked}</p>}
              {!r.available && <p className="text-caption text-amber">{p.unavailable}</p>}
            </li>
          );
        })}
      </ul>
      <form onSubmit={addTool} className="grid gap-1.5">
        <label htmlFor={`own-${agentId}`} className="text-small font-medium">{p.ownTitle}</label>
        <div className="flex gap-2">
          <input id={`own-${agentId}`} value={newTool} onChange={(e) => setNewTool(e.target.value)} placeholder="send_email" spellCheck={false} autoComplete="off"
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-small outline-none focus-visible:border-primary" />
          <Button type="submit" variant="outline" size="sm" disabled={busy || !TOOL_ID.test(newTool.trim())}>{p.ownAdd}</Button>
        </div>
        <p className="text-caption text-faint">{p.ownHint}</p>
      </form>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void save()} disabled={busy || changes.length === 0}>{busy ? p.saving : p.save}</Button>
        <Button variant="outline" size="sm" onClick={() => void preview()} disabled={busy || changes.length === 0}>{p.simulate}</Button>
        <Button variant="ghost" size="sm" onClick={askAll} disabled={busy}>{p.askAll}</Button>
        <span className="text-caption text-faint">{view.enforcement === "enforce" ? p.enforced : p.monitored}</span>
      </div>
      {sim && changes.length > 0 && (
        <section aria-label={p.simTitle} className="rounded-xl border border-border bg-sunken/40 px-4 py-3.5 text-small">
          <h3 className="font-medium">{p.simTitle}</h3>
          {sim.actions === 0 ? <p className="mt-1 text-muted-foreground">{p.simNone}</p> : (
            <>
              <p className="mt-1 text-muted-foreground">{p.simSummary(sim.actions)}</p>
              <p className="mt-1 font-medium tabular-nums">{p.simCounts(sim.would.allow, sim.would.approve, sim.would.deny)}</p>
              <p className="mt-2 text-muted-foreground">{p.simChanged(Object.values(sim.changes).reduce((a, b) => a + b, 0))}</p>
              {sim.examples.length > 0 && (
                <ul className="mt-1.5 grid gap-1">
                  {sim.examples.slice(0, 6).map((x) => (
                    <li key={x.id} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-caption">{x.tool}.{x.action}{x.resource ? ` ${x.resource}` : ""}</span>
                      <span className="text-caption text-muted-foreground">{p.choice[choiceOf(x.was)]} → <span className="font-medium text-foreground">{p.choice[choiceOf(x.would)]}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <p className="mt-2 text-caption text-faint">{p.simNote}</p>
        </section>
      )}
      <p role="status" className="text-small text-muted-foreground">{changes.length ? p.unsaved : (notice ?? "")}</p>
      <Disclosure summary={p.jsonTitle}>
        <div className="mt-2 grid gap-2">
          <p className="text-caption text-faint">{p.jsonHint}</p>
          <textarea aria-label={p.jsonTitle} spellCheck={false} rows={10} value={json ?? JSON.stringify(view.rules, null, 2)} onChange={(e) => setJson(e.target.value)}
            className="w-full rounded-lg border border-border bg-background p-3 font-mono text-caption outline-none focus-visible:border-primary" />
          <div><Button variant="outline" size="sm" disabled={busy || json === null} onClick={() => void saveJson()}>{p.jsonSave}</Button></div>
        </div>
      </Disclosure>
      <p className="text-caption text-faint">{p.enforcedNote}</p>
    </div>
  );
}
