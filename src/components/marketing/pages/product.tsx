"use client";

import dynamic from "next/dynamic";
import { useT } from "@/i18n/client";
import { Closing } from "../home-sections";
import { Band, Caption, Container, DisplayTitle, ExploreLink, PrimaryLink, QuietLink, Terminal } from "../kit";
import { LazyMount } from "../lazy";
import { TERMINALS, type ProductSlug } from "../site-data";
import type { HomeImages } from "../types";

// Every screen loads as someone scrolls toward it (LazyMount), so a product page's first load carries none of them.
const lazy = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) => dynamic(() => load().then((m) => m[name]), { ssr: false });
const ApprovalsPanel = lazy(() => import("../panels/approvals"), "ApprovalsPanel");
const ExactPanel = lazy(() => import("../panels/approvals"), "ExactPanel");
const PhonePanel = lazy(() => import("../panels/approvals"), "PhonePanel");
const RulesPanel = lazy(() => import("../panels/rules"), "RulesPanel");
const ConditionPanel = lazy(() => import("../panels/rules"), "ConditionPanel");
const CentralPolicyPanel = lazy(() => import("../panels/rules"), "CentralPolicyPanel");
const ActivityPanel = lazy(() => import("../panels/activity"), "ActivityPanel");
const ChainPanel = lazy(() => import("../panels/activity"), "ChainPanel");
const DayPanel = lazy(() => import("../panels/activity"), "DayPanel");
const AgentsPanel = lazy(() => import("../panels/agents"), "AgentsPanel");
const ConnectPanel = lazy(() => import("../panels/agents"), "ConnectPanel");
const IntegrationsPanel = lazy(() => import("../panels/agents"), "IntegrationsPanel");
const ChecksPanel = lazy(() => import("../panels/checks"), "ChecksPanel");
const ScenariosPanel = lazy(() => import("../panels/checks"), "ScenariosPanel");

/** What each product page shows, each screen once: the big one, two smaller ones, and where each caption's link leads. */
const PAGES: Record<ProductSlug, { main: React.ReactNode; a: React.ReactNode; b: React.ReactNode; href: [string, string, string]; cli: string }> = {
  approvals: { main: <ApprovalsPanel />, a: <ExactPanel />, b: <PhonePanel />, href: ["/how-it-works#steps", "/docs#approval-binding", "/docs"], cli: "/docs" },
  rules: { main: <RulesPanel />, a: <ConditionPanel />, b: <CentralPolicyPanel />, href: ["/how-it-works#steps", "/docs", "/how-it-works"], cli: "/docs" },
  activity: { main: <ActivityPanel />, a: <ChainPanel />, b: <DayPanel />, href: ["/how-it-works#steps", "/docs#audit-log", "/product/approvals"], cli: "/docs" },
  agents: { main: <AgentsPanel />, a: <ConnectPanel />, b: <IntegrationsPanel />, href: ["/docs", "/docs", "/verification-report"], cli: "/docs" },
  checks: { main: <ChecksPanel />, a: <ScenariosPanel />, b: <IntegrationsPanel />, href: ["/verification-report", "/verification-report", "/docs"], cli: "/verification-report" },
};

/**
 * One product page: "TEND / Approvals", a two-line headline and one sentence with the two buttons; the big clickable screen with
 * its caption; two smaller ones side by side; the same thing from the terminal, with TEND's real commands; and the last word.
 */
export function ProductPage({ slug, accounts, demo }: { slug: ProductSlug; accounts: boolean; demo: boolean; images?: HomeImages }) {
  const t = useT();
  const f = t.front;
  const p = f.product[slug];
  const page = PAGES[slug];
  return (
    <>
      <Container className="pt-14 pb-12 text-center md:pt-24 md:pb-16">
        <DisplayTitle crumb={f.product.crumb(p.name)} lines={p.title} />
        <p className="mx-auto mt-6 max-w-[46ch] text-[17px] leading-[1.5] text-foreground/80">{p.lead}</p>
        <div className="mx-auto mt-7 grid w-full max-w-[360px] gap-2.5 sm:flex sm:w-auto sm:max-w-none sm:justify-center">
          <PrimaryLink href={accounts ? "/account/sign-up" : "/operator"} size="lg">{f.create}</PrimaryLink>
          <QuietLink href="/how-it-works" size="lg">{f.hero.howItWorks}</QuietLink>
        </div>
      </Container>

      <Container className="pb-14 md:pb-20">
        <h2 className="sr-only">{p.main[0]}</h2>
        <LazyMount className={slug === "agents" ? "min-h-[270px]" : "min-h-[560px]"}>{page.main}</LazyMount>
        <Caption title={p.main[0]} body={p.main[1]} link={p.main[2]} href={page.href[0]} className="mt-8" />
      </Container>

      <Container className="pb-16 md:pb-24">
        <div className="grid overflow-hidden rounded-2xl border border-white/[0.08] md:grid-cols-2">
          {([[page.a, p.a, page.href[1]], [page.b, p.b, page.href[2]]] as const).map(([screen, words, href], i) => (
            <div key={i} className="flex flex-col gap-8 border-white/[0.08] p-5 sm:p-8 max-md:not-first:border-t md:not-first:border-l">
              <LazyMount className="min-h-[360px] flex-1">{screen}</LazyMount>
              <Caption level={2} title={words[0]} body={words[1]} link={words[2]} href={href} />
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
          <LazyMount className="min-h-[342px]"><Terminal {...TERMINALS[slug]} minHeight={300} /></LazyMount>
        </Container>
      </Band>

      <Closing accounts={accounts} demo={demo} />
    </>
  );
}
