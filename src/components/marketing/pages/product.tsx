"use client";

import { useT } from "@/i18n/client";
import { Closing } from "../home-sections";
import { Band, Caption, Container, DisplayTitle, ExploreLink, PrimaryLink, QuietLink, Terminal } from "../kit";
import { ActivityMini, ActivityPanel, ChainPanel, DayPanel } from "../panels/activity";
import { AgentsMini, AgentsPanel, ConnectPanel, IntegrationsPanel } from "../panels/agents";
import { ApprovalsMini, ApprovalsPanel, ExactPanel, PhonePanel } from "../panels/approvals";
import { ChecksMini, ChecksPanel, ScenariosPanel } from "../panels/checks";
import { CentralPolicyPanel, ConditionPanel, RulesMini, RulesPanel } from "../panels/rules";
import { TERMINALS, type ProductSlug } from "../site-data";
import type { HomeImages } from "../types";

/** What each product page shows: a small screen on top, the big one, two smaller ones, and where each caption's link leads. */
const PAGES: Record<ProductSlug, { top: React.ReactNode; main: React.ReactNode; a: React.ReactNode; b: React.ReactNode; href: [string, string, string]; cli: string }> = {
  approvals: { top: <ApprovalsMini />, main: <ApprovalsPanel />, a: <ExactPanel />, b: <PhonePanel />, href: ["/how-it-works#steps", "/security", "/docs"], cli: "/docs" },
  rules: { top: <RulesMini />, main: <RulesPanel />, a: <ConditionPanel />, b: <CentralPolicyPanel />, href: ["/how-it-works#steps", "/docs", "/how-it-works"], cli: "/docs" },
  activity: { top: <ActivityMini />, main: <ActivityPanel />, a: <ChainPanel />, b: <DayPanel />, href: ["/how-it-works#steps", "/security#doesnt", "/product/approvals"], cli: "/docs" },
  agents: { top: <AgentsMini />, main: <AgentsPanel />, a: <ConnectPanel />, b: <IntegrationsPanel />, href: ["/docs", "/docs", "/verification-report"], cli: "/docs" },
  checks: { top: <ChecksMini />, main: <ChecksPanel />, a: <ScenariosPanel />, b: <IntegrationsPanel />, href: ["/verification-report", "/verification-report", "/docs"], cli: "/verification-report" },
};

/**
 * One product page, in the template of sim.ai's: a small live screen, "TEND / Approvals" and a large headline; a statement with the
 * sentence and buttons beside it; the big clickable screen with its caption; two smaller ones side by side; the same thing from the
 * terminal, with TEND's real commands; and the last word.
 */
export function ProductPage({ slug, accounts, demo, images }: { slug: ProductSlug; accounts: boolean; demo: boolean; images: HomeImages }) {
  const t = useT();
  const f = t.front;
  const p = f.product[slug];
  const page = PAGES[slug];
  return (
    <>
      <Container className="pt-14 md:pt-20">
        <div className="mx-auto max-w-[460px] [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">{page.top}</div>
        <DisplayTitle crumb={f.product.crumb(p.name)} lines={p.title} className="mt-10 pb-16 md:mt-12 md:pb-24" />
      </Container>

      <Band>
        <Container className="grid gap-6 py-14 md:grid-cols-2 md:gap-16 md:py-20">
          <h2 className="mk-display text-[clamp(2.1rem,4.6vw,3.5rem)]">{p.statement.map((l) => <span key={l} className="block">{l}</span>)}</h2>
          <div className="md:pt-2">
            <p className="max-w-[46ch] text-[17px] leading-[1.5] text-foreground/80">{p.lead}</p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <PrimaryLink href={accounts ? "/account/sign-up" : "/operator"}>{f.create}</PrimaryLink>
              <QuietLink href="/how-it-works">{f.hero.howItWorks}</QuietLink>
            </div>
          </div>
        </Container>
      </Band>

      <Container className="pb-14 md:pb-20">
        {page.main}
        <Caption title={p.main[0]} body={p.main[1]} link={p.main[2]} href={page.href[0]} className="mt-8" />
      </Container>

      <Container className="pb-16 md:pb-24">
        <div className="grid overflow-hidden rounded-2xl border border-white/[0.08] md:grid-cols-2">
          {([[page.a, p.a, page.href[1]], [page.b, p.b, page.href[2]]] as const).map(([screen, words, href], i) => (
            <div key={i} className="flex flex-col gap-8 border-white/[0.08] p-5 sm:p-8 max-md:not-first:border-t md:not-first:border-l">
              <div className="flex-1">{screen}</div>
              <Caption title={words[0]} body={words[1]} link={words[2]} href={href} />
            </div>
          ))}
        </div>
      </Container>

      <Band>
        <Container className="grid gap-10 py-16 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:items-center md:gap-16 md:py-24">
          <div>
            <p className="text-[14px] text-muted-foreground">{f.product.terminal}</p>
            <h2 className="mk-display mt-4 text-[clamp(2rem,4.2vw,3.25rem)]">{p.cli.map((l) => <span key={l} className="block">{l}</span>)}</h2>
            <p className="mt-5 max-w-[42ch] text-[16px] leading-relaxed text-muted-foreground">{p.cliBody}</p>
            <ExploreLink href={page.cli} className="mt-6">{p.cliLink}</ExploreLink>
          </div>
          <Terminal {...TERMINALS[slug]} minHeight={300} />
        </Container>
      </Band>

      <Closing accounts={accounts} demo={demo} images={images} />
    </>
  );
}
