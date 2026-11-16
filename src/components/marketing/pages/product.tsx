"use client";

import { useT } from "@/i18n/client";
import { Closing } from "../home-sections";
import { Band, Caption, Container, DisplayTitle, ExploreLink, PrimaryLink, QuietLink, Terminal } from "../kit";
import { Shot, type ShotName } from "../shot";
import { TERMINALS, type ProductSlug } from "../site-data";
import type { HomeImages } from "../types";

/** Which real screenshot each part of a product page shows (scripts/screens): the page's screen, then the two smaller ones. */
const PAGES: Record<ProductSlug, { main: ShotName; a: ShotName; b: ShotName; href: [string, string, string]; cli: string }> = {
  approvals: { main: "approvals", a: "approvals-card", b: "phone-approvals", href: ["/how-it-works#steps", "/security", "/docs"], cli: "/docs" },
  rules: { main: "policies", a: "policies-edit", b: "policies-json", href: ["/how-it-works#steps", "/docs", "/docs"], cli: "/docs" },
  activity: { main: "activity", a: "activity-blocked", b: "overview-stats", href: ["/how-it-works#steps", "/security#doesnt", "/product/approvals"], cli: "/docs" },
  agents: { main: "agents", a: "connect", b: "integrations", href: ["/docs", "/docs", "/verification-report"], cli: "/docs" },
  checks: { main: "checks", a: "integration-dialog", b: "integrations", href: ["/verification-report", "/verification-report", "/docs"], cli: "/verification-report" },
};
const PHONE = new Set<ShotName>(["phone-approvals"]);

/**
 * One product page, in the template of sim.ai's: a small live screen, "TEND / Approvals" and a large headline; a statement with the
 * sentence and buttons beside it; the big clickable screen with its caption; two smaller ones side by side; the same thing from the
 * terminal, with TEND's real commands; and the last word.
 */
export function ProductPage({ slug, accounts, demo }: { slug: ProductSlug; accounts: boolean; demo: boolean; images?: HomeImages }) {
  const t = useT();
  const f = t.front;
  const p = f.product[slug];
  const page = PAGES[slug];
  const alt = f.shots as Record<string, string>;
  return (
    <>
      <Container className="pt-14 md:pt-20">
        <div aria-hidden className="-mr-5 max-h-[300px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)] sm:-mr-8 md:mx-auto md:max-h-[280px] md:max-w-[460px] md:[mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
          <Shot name={page.main} alt="" sizes="(min-width: 768px) 460px, 620px" className="w-[620px] md:w-auto" />
        </div>
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
        <Shot name={page.main} alt={alt[page.main]} sizes="(min-width: 1200px) 1136px, 92vw" />
        <Caption title={p.main[0]} body={p.main[1]} link={p.main[2]} href={page.href[0]} className="mt-8" />
      </Container>

      <Container className="pb-16 md:pb-24">
        <div className="grid overflow-hidden rounded-2xl border border-white/[0.08] md:grid-cols-2">
          {([[page.a, p.a, page.href[1]], [page.b, p.b, page.href[2]]] as const).map(([name, words, href], i) => (
            <div key={i} className="flex flex-col gap-8 border-white/[0.08] p-5 sm:p-8 max-md:not-first:border-t md:not-first:border-l">
              <div className="flex flex-1 items-start justify-center">
                {PHONE.has(name)
                  ? <Shot name={name} alt={alt[name]} sizes="260px" frame="phone" className="w-[260px]" />
                  : <Shot name={name} alt={alt[name]} sizes="(min-width: 1200px) 536px, (min-width: 768px) 44vw, 90vw" className="w-full" />}
              </div>
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

      <Closing accounts={accounts} demo={demo} />
    </>
  );
}
