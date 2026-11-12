"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dot, type Tone } from "@/components/kit";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n/error-text";
import { dateTime } from "@/lib/format";
import { useStore } from "@/lib/store";
import { outOfDate, type CheckGroup, type CheckResult, type CheckStatus, type VerificationRun } from "@/lib/verification";

const TONE: Record<CheckStatus, Tone> = { verified: "sage", at_risk: "amber", not_verified: "muted" };
const GROUPS: CheckGroup[] = ["live", "isolated", "outside"];

/**
 * The latest protection checks for one connected agent. Each result is about one stated claim, with what it shows and what it
 * does not. There is deliberately no total, grade or "protected" label: a list of claims, each Verified, At Risk or Not Verified.
 */
export function ProtectionChecks({ agentId, configVersion }: { agentId: string; configVersion: number }) {
  const t = useT();
  const p = t.protection;
  const getVerification = useStore((s) => s.getVerification);
  const runVerification = useStore((s) => s.runVerification);
  const [run, setRun] = useState<VerificationRun | null | undefined>(undefined);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((r: Awaited<ReturnType<typeof getVerification>>) => {
    if (!r.ok) return setFailed(errorText(t, r));
    setFailed(null);
    setRun(r.data.run);
  }, [t]);

  // The parent keys this component by agent, so a different agent starts from a clean state.
  useEffect(() => {
    let live = true;
    void getVerification(agentId).then((r) => live && apply(r));
    return () => {
      live = false;
    };
  }, [agentId, getVerification, apply]);

  const runNow = async () => {
    setBusy(true);
    const r = await runVerification(agentId);
    setBusy(false);
    apply(r);
  };

  /** Tool ids become the names a person knows. */
  const names = (f: CheckResult["facts"]) =>
    Object.fromEntries(Object.entries(f).map(([k, v]) => [k, !Array.isArray(v) ? v : k === "failed" ? v.map((x) => p.failed[x] ?? x).join("; ") : v.map((x) => t.tools.names[x] ?? x).join(", ")]));

  const sentence = (c: CheckResult) => {
    const f = names(c.facts);
    if (c.status === "verified") return p.checks[c.id].verified(f);
    return (p.reasons[c.why ?? ""] ?? (() => ""))(f);
  };

  const row = (c: CheckResult) => {
    const copy = p.checks[c.id];
    const skipped = Array.isArray(c.facts.notTested) ? p.notTested(String(names(c.facts).notTested)) : null;
    return (
      <li key={c.id} className="grid gap-1.5 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-small font-medium"><Dot tone={TONE[c.status]} />{p.status[c.status]}</span>
          <span className="text-sm">{copy.title}</span>
        </div>
        {sentence(c) && <p className="text-small text-muted-foreground">{sentence(c)}</p>}
        {skipped && <p className="text-caption text-faint">{skipped}</p>}
        <details className="text-small text-muted-foreground">
          <summary className="cursor-pointer text-faint">{p.shows} / {p.notShow}</summary>
          <p className="mt-2"><span className="font-medium text-foreground">{p.shows}.</span> {copy.shows}</p>
          <p className="mt-1.5"><span className="font-medium text-foreground">{p.notShow}.</span> {copy.notShow}</p>
          <p className="mt-1.5 text-faint">{p.statusNote[c.status]}</p>
        </details>
      </li>
    );
  };

  if (failed && run === undefined)
    return (
      <div className="grid justify-items-start gap-3">
        <p role="alert" className="text-small text-destructive">{p.loadFailed} {failed}</p>
        <Button variant="outline" size="sm" onClick={async () => apply(await getVerification(agentId))}>{p.retry}</Button>
      </div>
    );
  if (run === undefined) return <p className="text-small text-faint">…</p>;

  return (
    <div className="grid gap-5" aria-busy={busy}>
      <p className="text-small text-muted-foreground">{p.intro}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void runNow()} disabled={busy}>{busy ? p.running : run ? p.runAgain : p.run}</Button>
        <span className="text-caption text-faint">{run ? p.lastRun(dateTime(run.at)) : p.never}</span>
      </div>
      {failed && <p role="alert" className="text-small text-destructive">{p.runFailed} {failed}</p>}
      {run && outOfDate(run, { configVersion }) && <p role="status" className="text-small text-amber">{p.outOfDate}</p>}
      {run && (
        <>
          <p className="text-small text-muted-foreground">
            {run.runsWithoutAsking.length ? p.runsWithoutAsking(run.runsWithoutAsking.map((x) => t.tools.names[x] ?? x).join(", ")) : p.nothingRunsAlone}
          </p>
          {GROUPS.map((g) => (
            <section key={g}>
              <h3 className="text-sm font-medium">{p.groups[g].title}</h3>
              <p className="mt-1 text-caption text-faint">{p.groups[g].note}</p>
              <ul className="mt-1 divide-y divide-border border-y border-border">{run.checks.filter((c) => c.group === g).map(row)}</ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
