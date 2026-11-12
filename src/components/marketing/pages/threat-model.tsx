"use client";

import { CheckIcon, MinusIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { Bullets, CardGrid, EndBand, InfoCard, PageHeader, PageSection, Panel } from "../page-parts";

/** One box of the trust-boundary diagram. */
function Box({ name, note, trusted }: { name: string; note: string; trusted: boolean }) {
  return (
    <div className={`rounded-xl border bg-[#141414] px-4 py-3 ${trusted ? "border-sage/40" : "border-dashed border-white/25"}`}>
      <p className="text-[15px] font-medium">{name}</p>
      <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{note}</p>
    </div>
  );
}
/** A labelled link between two boxes: across on a wide screen, down on a phone. */
function Link({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-1 md:flex-col md:px-1 md:py-0">
      <span aria-hidden className="h-6 w-px bg-white/30 md:h-px md:w-full" />
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{label}</span>
      <span aria-hidden className="h-6 w-px bg-white/30 md:h-px md:w-full" />
    </div>
  );
}

/**
 * The threat model: the trust boundary (agent, TEND, tool APIs, and the operator's browser), what TEND stops, what it doesn't, and
 * what it assumes. Facts from docs/gateway.md, docs/enforcement.md and docs/security-limitations.md.
 */
export function ThreatModelPage({ accounts }: { accounts: boolean }) {
  const t = useT();
  const p = t.front.pages.threatModel;
  const b = p.boundary;
  return (
    <>
      <PageHeader eyebrow={p.eyebrow} title={p.title} lead={p.lead} />
      <PageSection id="boundary" title={p.boundaryTitle}>
        <Panel>
          <figure>
            <div className="grid items-center md:grid-cols-[minmax(0,1fr)_96px_minmax(0,1fr)_96px_minmax(0,1fr)]">
              <Box name={b.agent[0]} note={b.agent[1]} trusted={false} />
              <Link label={b.agentKey} />
              <Box name={b.tend[0]} note={b.tend[1]} trusted />
              <Link label={b.credential} />
              <Box name={b.tool[0]} note={b.tool[1]} trusted />
            </div>
            <div className="grid md:grid-cols-[minmax(0,1fr)_96px_minmax(0,1fr)_96px_minmax(0,1fr)]">
              <div className="md:col-start-3">
                <div className="flex flex-col items-center py-1"><span aria-hidden className="h-6 w-px bg-white/30" /><span className="font-mono text-[11px] text-muted-foreground">{b.session}</span><span aria-hidden className="h-6 w-px bg-white/30" /></div>
                <Box name={b.operator[0]} note={b.operator[1]} trusted />
              </div>
            </div>
            <figcaption className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-muted-foreground">
              <span className="flex items-center gap-2"><span aria-hidden className="h-3 w-5 rounded border border-sage/50" />{b.tend[1].split(".")[0]}</span>
              <span className="flex items-center gap-2"><span aria-hidden className="h-3 w-5 rounded border border-dashed border-white/40" />{b.agent[1].split(".")[0]}</span>
            </figcaption>
          </figure>
        </Panel>
      </PageSection>
      <PageSection id="stops" title={p.protectsTitle}>
        <CardGrid>{p.protects.map(([title, body]) => <InfoCard key={title} icon={<CheckIcon className="size-3.5 text-sage" strokeWidth={2} aria-hidden />} title={title}>{body}</InfoCard>)}</CardGrid>
      </PageSection>
      <PageSection id="doesnt" title={p.notTitle}>
        <CardGrid>{p.not.map(([title, body]) => <InfoCard key={title} icon={<MinusIcon className="size-3.5" strokeWidth={2} aria-hidden />} title={title}>{body}</InfoCard>)}</CardGrid>
      </PageSection>
      <PageSection id="assumptions" title={p.assumeTitle}>
        <Panel><div className="max-w-[72ch] text-[15px] leading-relaxed text-foreground/85"><Bullets items={p.assume} /></div></Panel>
      </PageSection>
      <EndBand title={p.end} accounts={accounts} secondary={{ label: p.endLink, href: "/security#break" }} />
    </>
  );
}
