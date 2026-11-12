"use client";

import { useEffect, useState } from "react";
import { ListChecksIcon, ShieldCheckIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { SCENARIOS } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import { CHECKS, type CheckGroup, type CheckId, type CheckStatus } from "@/lib/verification";
import { buttonClass } from "@/ui/primitives";
import { AppPanel, ExampleTag, prefersReducedMotion } from "../kit";

const DOT: Record<CheckStatus, string> = { verified: "bg-sage", at_risk: "bg-amber", not_verified: "bg-muted-foreground" };
type Facts = Record<string, string | number>;
/**
 * The sample run for ops-agent, in the shape the server reports (server/verification-live.ts, -sandbox.ts): the notes folder isn't set
 * up, and nothing outside TEND can be seen, so those two can't be confirmed.
 */
const RUN: Record<CheckId, { status: CheckStatus; why?: string; facts?: Facts; tested?: string[] }> = {
  folder_closed: { status: "not_verified", why: "not_configured" },
  alert_if_outside: { status: "verified" },
  history_approved: { status: "verified", facts: { checked: 9 } },
  history_once: { status: "verified", facts: { checked: 9 } },
  ever_outside: { status: "verified" },
  forbidden_refused: { status: "verified", tested: ["read_test_file", "write_test_file", "delete_test_file", "test_ping"] },
  malformed_refused: { status: "verified" },
  ask_first_holds: { status: "verified", tested: ["pay_invoice", "write_note"] },
  rejection_holds: { status: "verified", tested: ["pay_invoice", "write_note"] },
  approval_once: { status: "verified", tested: ["pay_invoice", "write_note"] },
  agent_isolated: { status: "not_verified", why: "cannot_be_checked" },
};
/** What ops-agent's sample policy lets run without asking (the Rules page's sample). */
const RUNS_ALONE = ["list_notes", "read_note"];
const clockNow = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * One agent's checks as the app's component draws them (components/protection-checks.tsx): Run the checks with the last run, what runs
 * without asking, then each group with a dot and a word per check, its sentence, and what it shows and doesn't. Never a total.
 */
export function ChecksPanel() {
  const t = useT();
  const p = t.protection;
  const [at, setAt] = useState("14:05");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const id = window.setTimeout(() => { setBusy(false); setAt(clockNow()); }, prefersReducedMotion() ? 0 : 1400);
    return () => clearTimeout(id);
  }, [busy]);
  const sentence = (id: CheckId) => {
    const r = RUN[id];
    const f: Facts = { ...r.facts, ...(r.tested && { tested: r.tested.map((x) => t.tools.names[x] ?? x).join(", ") }) };
    return r.status === "verified" ? p.checks[id].verified(f as never) : (p.reasons[r.why ?? ""] ?? (() => ""))(f as never);
  };
  return (
    <AppPanel title={`${p.title} · ops-agent`} icon={ShieldCheckIcon} right={<ExampleTag />} bodyClassName="grid gap-5 p-4 md:p-5">
      <p className="text-[13px] text-muted-foreground">{p.intro}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={() => setBusy(true)} className={cn(buttonClass(), "h-9 px-3 text-[13px]")}>{busy ? p.running : p.runAgain}</button>
        <span className="text-[12px] text-faint">{p.lastRun(at)}</span>
      </div>
      <div aria-busy={busy} className={cn("grid gap-5 transition-opacity", busy && "opacity-50")}>
        <p className="text-[13px] text-muted-foreground">{p.runsWithoutAsking(RUNS_ALONE.map((x) => t.tools.names[x] ?? x).join(", "))}</p>
        {(Object.keys(CHECKS) as CheckGroup[]).map((g) => (
          <section key={g}>
            <h3 className="text-[14px] font-medium">{p.groups[g].title}</h3>
            <p className="mt-1 text-[12px] text-faint">{p.groups[g].note}</p>
            <ul className="mt-1 divide-y divide-border border-y border-border">
              {CHECKS[g].map((id) => {
                const status = RUN[id].status;
                const text = sentence(id);
                return (
                  <li key={id} className="grid gap-1.5 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium"><span aria-hidden className={cn("size-1.5 rounded-full", DOT[status])} />{p.status[status]}</span>
                      <span className="text-[14px]">{p.checks[id].title}</span>
                    </div>
                    {text && <p className="text-[13px] text-muted-foreground">{text}</p>}
                    <details className="text-[13px] text-muted-foreground">
                      <summary className="cursor-pointer text-faint">{p.shows} / {p.notShow}</summary>
                      <p className="mt-2"><span className="font-medium text-foreground">{p.shows}.</span> {p.checks[id].shows}</p>
                      <p className="mt-1.5"><span className="font-medium text-foreground">{p.notShow}.</span> {p.checks[id].notShow}</p>
                      <p className="mt-1.5 text-faint">{p.statusNote[status]}</p>
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </AppPanel>
  );
}

/**
 * The seven scenarios as the Integrations page lists them for one integration (app/(next)/integrations/view.tsx): each scenario with
 * its verdict from the last full run, and how to rerun them. The suite runs from the terminal, not from a button.
 */
export function ScenariosPanel() {
  const t = useT();
  const g = t.integrations;
  return (
    <AppPanel title={`${g.exercised} · Claude`} icon={ListChecksIcon} right={<ExampleTag />} bodyClassName="grid gap-3 p-4">
      <ol className="grid gap-1">
        {SCENARIOS.map((id, i) => (
          <li key={id} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-[13px]">
            <span aria-hidden className="grid size-5 place-items-center rounded-full border border-border text-[11px] text-muted-foreground tabular-nums">{i + 1}</span>
            <span className="flex-1">{g.scenarios[id]}</span>
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium"><span aria-hidden className="size-1.5 rounded-full bg-sage" />{g.verdict.PASS}</span>
          </li>
        ))}
      </ol>
      <p className="text-[12px] text-muted-foreground">{g.lastTest}: 2026-10-30</p>
      <p className="font-mono text-[12px] text-faint">{g.rerun}</p>
    </AppPanel>
  );
}
