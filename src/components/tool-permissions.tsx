"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n";
import { applyChoices, choiceOf, type Choice, type PolicyView } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const CHOICES: Choice[] = ["allow", "ask", "never"];

/**
 * What a connected agent may do, one row per gateway tool. It shows what the server reports it would decide, and after
 * every save it asks the server again and shows that, so the screen cannot drift from the saved policy. Nothing here is
 * trusted: the server validates the rules and refuses to let a spending tool run without approval.
 */
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

  const rows = view.tools;
  const current = (tool: string) => draft[tool] ?? choiceOf(rows.find((r) => r.tool === tool)!.effect);
  const changes = rows.filter((r) => !r.custom && draft[r.tool] !== undefined && draft[r.tool] !== choiceOf(r.effect));
  const pick = (tool: string, c: Choice) => (setNotice(null), setDraft((d) => ({ ...d, [tool]: c })));
  const askAll = () => (setNotice(null), setDraft(Object.fromEntries(rows.filter((r) => !r.custom).map((r) => [r.tool, "ask" as Choice]))));

  const save = async () => {
    setBusy(true);
    const r = await savePolicy(agentId, { rules: applyChoices(view.rules, changes.map((c) => ({ tool: c.tool, action: c.action, choice: draft[c.tool] }))), expectedVersion: view.version });
    // Whatever happened, show what the server has now.
    const fresh = apply(await getPolicy(agentId));
    setBusy(false);
    if (!r.ok) return toast.error(errorText(t, r));
    const kept = rows.filter((x) => !x.custom && fresh && draft[x.tool] !== undefined && choiceOf(fresh.tools.find((y) => y.tool === x.tool)!.effect) !== draft[x.tool]);
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
              {r.custom ? (
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
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void save()} disabled={busy || changes.length === 0}>{busy ? p.saving : p.save}</Button>
        <Button variant="ghost" size="sm" onClick={askAll} disabled={busy}>{p.askAll}</Button>
        <span className="text-caption text-faint">{view.enforcement === "enforce" ? p.enforced : p.monitored}</span>
      </div>
      <p role="status" className="text-small text-muted-foreground">{changes.length ? p.unsaved : (notice ?? "")}</p>
      <p className="text-caption text-faint">{p.enforcedNote}</p>
    </div>
  );
}
