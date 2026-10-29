"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { useStore } from "@/lib/store";

type Step = { id: string; tool: string; action: string; resource: string; result: string };
const KEY = "tend.sample.ids";
// The run's ids survive a visit to Approvals in this tab. Storage can be unavailable (private mode): then the card simply starts empty.
const remember = (ids: string[]) => { try { sessionStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* not kept */ } };
const recall = (): string[] => { try { const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 10) : []; } catch { return []; } };

/** Try TEND without code: a simulated agent asks for three harmless actions; the real policy, approval queue and audit log handle them. */
export function SampleAgent() {
  const t = useT();
  const s = t.connect.sample;
  const poll = useStore((x) => x.poll);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async (body: { step: "start" } | { step: "continue"; ids: string[] }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/sample-agent", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(typeof data.message === "string" ? data.message : s.failed);
      else {
        const next: Step[] = Array.isArray(data.steps) ? data.steps : [];
        setSteps(next);
        if (body.step === "start") remember(next.map((x) => x.id));
      }
      await poll();
    } catch {
      setError(s.failed);
    } finally {
      setBusy(false);
    }
  };
  // Coming back from Approvals: show where the last run stands, without running anything.
  useEffect(() => {
    const ids = recall();
    if (!ids.length) return;
    let live = true;
    fetch("/api/v1/sample-agent", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ step: "status", ids }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && Array.isArray(d.steps)) setSteps(d.steps); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  const waiting = steps.some((x) => x.result === "waiting");
  const link = "text-primary underline-offset-4 hover:underline";
  return (
    <section aria-labelledby="cn-sample" className="mt-16 rounded-xl border border-border bg-background px-6 py-5">
      <h2 id="cn-sample" className="text-[17px] font-semibold">{s.title}</h2>
      <p className="mt-1 max-w-[70ch] text-[14px] text-pretty text-muted-foreground">{s.body}</p>
      <div className="mt-4 flex flex-wrap gap-2.5">
        <Button className="h-10 px-4 text-small" disabled={busy} onClick={() => void go({ step: "start" })}>{s.start}</Button>
        {steps.length > 0 && <Button variant="secondary" className="h-10 border-border px-4 text-small" disabled={busy} onClick={() => void go({ step: "continue", ids: steps.map((x) => x.id) })}>{s.next}</Button>}
      </div>
      {steps.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-ui">
          {steps.map((x) => (
            <li key={x.id}><span className="font-mono text-caption">{x.tool}.{x.action} {x.resource}</span>: {(s.result as Record<string, string>)[x.result] ?? x.result}</li>
          ))}
        </ul>
      )}
      {waiting && <p className="mt-3 text-small">{s.waitingHint} <Link href="/oversight" className={link}>{s.approvals}</Link></p>}
      {steps.length > 0 && <p className="mt-2 text-small text-muted-foreground"><Link href="/timeline" className={link}>{s.audit}</Link></p>}
      <p role="status" className="sr-only">{busy ? s.working : ""}</p>
      {error && <p role="alert" className="mt-3 text-small text-clay">{error}</p>}
    </section>
  );
}
