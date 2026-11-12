"use client";

import { useT } from "@/i18n/client";
import { EndBand, PageHeader, PageSection } from "../page-parts";

/**
 * "Why not just use…": fair answers on MCP permissions, Claude Code's approvals and a sandbox, each with when it is the better
 * choice, then the three things TEND adds, side by side. From docs/competitive.md (checked against each product's own docs).
 */
export function ComparePage({ accounts }: { accounts: boolean }) {
  const t = useT();
  const p = t.front.pages.compare;
  return (
    <>
      <PageHeader eyebrow={p.eyebrow} title={p.title} lead={p.lead} />
      <section className="px-5 pt-12 sm:px-8 md:pt-16">
        <div className="mx-auto grid max-w-[1136px] gap-4 md:grid-cols-3">
          {p.questions.map(([q, answer, better], i) => (
            <article key={q} aria-labelledby={`q-${i}`} className="flex flex-col rounded-2xl border border-white/[0.08] bg-mk-surface p-6">
              <h2 id={`q-${i}`} className="text-[20px] font-medium tracking-[-0.015em]">{q}</h2>
              <p className="mt-3 flex-1 text-[14.5px] leading-relaxed text-foreground/80">{answer}</p>
              <div className="mt-5 border-t border-white/[0.08] pt-4">
                <p className="text-[12px] text-muted-foreground">{p.better}</p>
                <p className="mt-1 text-[14px] leading-snug text-foreground/90">{better}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <PageSection id="table" title={p.tableTitle}>
        {/* On a phone each row is a card, so nothing scrolls sideways; from 640px it is a table. */}
        <ul className="grid gap-3 sm:hidden">
          {p.rows.map(([label, ...cells]) => (
            <li key={label} className="rounded-2xl border border-white/[0.08] bg-mk-surface p-5">
              <p className="text-[16px] font-medium">{label}</p>
              <dl className="mt-3 grid gap-2 text-[14px]">
                {cells.map((c, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3">
                    <dt className={i === 0 ? "font-medium text-foreground" : "text-muted-foreground"}>{p.columns[i + 1]}</dt>
                    <dd className={i === 0 ? "text-foreground" : "text-muted-foreground"}>{c}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
        <div className="hidden sm:block">
          <table className="w-full border-collapse text-left text-[14px]">
            <thead>
              <tr className="border-b border-white/[0.12]">
                {p.columns.map((c, i) => <th key={i} scope="col" className={`py-3 pr-4 font-medium ${i === 0 ? "text-[12px] font-normal text-muted-foreground" : i === 1 ? "text-foreground" : "text-muted-foreground"}`}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {p.rows.map(([label, ...cells]) => (
                <tr key={label} className="border-b border-white/[0.08]">
                  <th scope="row" className="py-4 pr-4 font-medium">{label}</th>
                  {cells.map((c, i) => <td key={i} className={`py-4 pr-4 ${i === 0 ? "text-foreground" : "text-muted-foreground"}`}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-5 text-[13px] text-muted-foreground">{p.note}</p>
      </PageSection>
      <EndBand title={p.end} accounts={accounts} secondary={{ label: p.endLink, href: "/verification-report" }} />
    </>
  );
}
