"use client";

import { IntegrationLogo } from "@/components/integration-logo";
import { useT } from "@/i18n/client";
import { INTEGRATIONS, SCENARIOS, STATUS_ORDER, statusOf, verificationOf } from "@/lib/integrations-catalog";
import REPORT from "@/lib/verification-report.json";
import { cn } from "@/lib/utils";
import { EndBand, PageHeader, PageSection } from "../page-parts";

/** A date as the report records it (UTC), the same on the server and in every browser. */
const day = (iso?: string) => (iso ? iso.slice(0, 10) : "");

const MARK = { verified: "bg-[#5fb892]", compatible: "border border-muted-foreground", blocked: "bg-[#d9a55b]", planned: "border border-dashed border-muted-foreground" } as const;

/**
 * The verification report as a page: the same catalog and report as the app's Connect page (lib/integrations-catalog.ts and
 * lib/verification-report.json, written by `npm run verify:integrations`). Nothing here is typed by hand, so it cannot claim more than ran.
 */
export function VerificationReportPage({ accounts }: { accounts: boolean }) {
  const t = useT();
  const p = t.front.pages.report;
  const g = t.integrations;
  const rows = [...INTEGRATIONS].sort((a, b) => STATUS_ORDER.indexOf(statusOf(a)) - STATUS_ORDER.indexOf(statusOf(b)));
  const verified = rows.filter((i) => statusOf(i) === "verified").length;
  return (
    <>
      <PageHeader eyebrow={p.eyebrow} title={p.title} lead={p.lead}>
        <p className="mt-8 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="mk-display text-[56px] leading-none tabular-nums">{verified}</span>
          <span className="text-[14px] text-muted-foreground">{p.summary(verified, rows.length)} · {p.lastRun(day((REPORT as { generatedAt?: string }).generatedAt))}</span>
        </p>
      </PageHeader>

      <PageSection id="scenarios" title={p.scenariosTitle}>
        <ol className="flex flex-wrap gap-2.5">
          {SCENARIOS.map((s, i) => (
            <li key={s} className="inline-flex h-10 items-center gap-2.5 rounded-full border border-border bg-mk-surface pr-4 pl-1.5 text-[14px]">
              <span aria-hidden className="grid size-7 place-items-center rounded-full border border-white/[0.14] text-[12px] font-medium tabular-nums">{i + 1}</span>{g.scenarios[s]}
            </li>
          ))}
        </ol>
      </PageSection>

      <PageSection id="integrations" title={g.title} lead={g.description}>
        <div className="overflow-hidden rounded-2xl border border-border bg-mk-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[14px]">
              <thead className="text-[13px] text-muted-foreground">
                <tr className="border-b border-border">{[p.columns.integration, p.columns.status, p.columns.tested, p.columns.lastRun].map((c) => <th key={c} scope="col" className="px-6 py-3.5 font-normal">{c}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((i) => {
                  const s = statusOf(i);
                  const v = verificationOf(i);
                  return (
                    <tr key={i.id} className="align-top">
                      <th scope="row" className="px-6 py-4 font-medium whitespace-nowrap">
                        <span className="flex items-center gap-3"><span className="mk-light"><IntegrationLogo entry={i} className="size-8 rounded-full" /></span>{i.name}</span>
                        <span className="mt-1 block pl-11 text-[12px] font-normal text-muted-foreground">{g.categories[i.category]}</span>
                      </th>
                      <td className="px-6 py-4 whitespace-nowrap"><span className="inline-flex items-center gap-2"><span aria-hidden className={cn("size-2 rounded-full", MARK[s])} />{g.status[s]}</span></td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {v?.label || g.statusHelp[s]}
                        {s === "blocked" && v?.missing?.length ? <span className="mt-1 block text-[13px] text-[#e4ba7a]">{p.needs}: {v.missing.join("; ")}</span> : null}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-muted-foreground tabular-nums">{day(v?.lastRunAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </PageSection>

      <EndBand title={p.end} accounts={accounts} secondary={{ label: p.endLink, href: "/docs" }} />
    </>
  );
}
