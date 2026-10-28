import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { Glyph } from "@/components/glyph";
import type { GlyphName } from "@/components/glyphs";
import { LanguageSwitch } from "@/components/language-switch";
import { HeroSanctuary, ReflectionsShowcase, Reveal } from "@/components/landing";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";

const BASICS: GlyphName[] = ["agents", "sanctuary", "oversight"];

function Label({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-3 text-caption text-faint">
      <span className="font-mono text-meta">{n}</span>
      <span className="h-px w-6 bg-border" />
      {children}
    </p>
  );
}

export default async function Landing() {
  const t = await getT();
  const l = t.landing;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 md:px-8">
          <Wordmark />
          <nav className="hidden items-center gap-7 text-small text-muted-foreground lg:flex" aria-label={l.sectionsLabel}>
            {(Object.entries(l.sections) as [string, string][]).map(([id, label]) => (
              <a key={id} href={`#${id}`} className="transition-colors hover:text-foreground">{label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <Button asChild variant="outline" size="sm"><Link href="/sanctuary">{l.open}</Link></Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="pt-20 md:pt-28">
          <div className="mx-auto max-w-6xl px-5 text-center md:px-8">
            <Reveal>
              <p className="inline-flex items-center gap-2 text-caption text-muted-foreground">
                <span className="size-1.5 shrink-0 rounded-full bg-sage max-sm:hidden" /> {l.badge}
              </p>
            </Reveal>
            <Reveal delay={0.06}>
              <h1 className="mt-6 text-headline text-balance">{l.title}</h1>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mx-auto mt-5 max-w-lg text-title font-normal text-balance text-muted-foreground">{l.tagline}</p>
              <p className="mx-auto mt-3 max-w-md text-small text-faint">{l.sub}</p>
            </Reveal>
            <Reveal delay={0.18} className="mt-9 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Button asChild size="lg" className="h-10 px-5"><Link href="/sanctuary">{l.explore} <ArrowRightIcon /></Link></Button>
              <Button asChild size="lg" variant="ghost" className="h-10 px-5 text-muted-foreground"><a href="#research">{l.readApproach}</a></Button>
            </Reveal>
          </div>
          <Reveal delay={0.25} className="mt-6">
            <HeroSanctuary />
            <p className="px-5 text-center text-caption text-faint">{l.heroCaption}</p>
          </Reveal>
        </section>

        {/* In short: three facts for anyone new to AI agents */}
        <section aria-label={l.basicsLabel} className="pt-20 md:pt-28">
          <div className="mx-auto max-w-6xl px-5 md:px-8">
            <Reveal><p className="eyebrow">{l.basicsLabel}</p></Reveal>
            <ol className="mt-6 grid gap-px border-y border-border bg-border md:grid-cols-3">
              {l.basics.map((b, i) => (
                <Reveal as="li" key={b.title} delay={0.05 * i} className="flex gap-4 bg-background py-6 md:px-6 md:first:pl-0">
                  <Glyph name={BASICS[i]} cell={2} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="block text-ui font-medium">{b.title}</span>
                    <span className="mt-1.5 block text-small leading-relaxed text-muted-foreground">{b.body}</span>
                  </span>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* 01 — The question: one statement, plenty of air */}
        <section id="question" className="scroll-mt-16 py-32 md:py-44">
          <div className="mx-auto max-w-6xl px-5 md:px-8">
            <Reveal><Label n="01">{l.question.label}</Label></Reveal>
            <Reveal delay={0.05}>
              <p className="mt-10 max-w-4xl text-section text-balance">
                {l.question.lead}{" "}
                <span className="text-muted-foreground">{l.question.rest}</span>
              </p>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-10 ml-auto max-w-sm border-l border-border pl-5 text-small text-faint md:mr-12">{l.question.note}</p>
            </Reveal>
          </div>
        </section>

        {/* 02 — The world: a legend, set as an index */}
        <section id="sanctuary" className="scroll-mt-16 border-t border-border py-28 md:py-36">
          <div className="mx-auto grid max-w-6xl gap-14 px-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] md:px-8">
            <Reveal className="md:sticky md:top-28 md:self-start">
              <Label n="02">{l.world.label}</Label>
              <h2 className="mt-8 text-section text-balance">{l.world.title}</h2>
              <p className="mt-5 max-w-sm text-body text-muted-foreground">{l.world.body}</p>
            </Reveal>
            <ol>
              {l.world.places.map(({ name, meaning, code }, i) => (
                <Reveal as="li" key={code} delay={0.04 * i} className="grid grid-cols-[2.5rem_1fr] gap-x-4 gap-y-1 border-t border-border py-6 sm:grid-cols-[2.5rem_1fr_auto]">
                  <span className="font-mono text-meta text-faint">{String(i + 1).padStart(2, "0")}</span>
                  <span>
                    <span className="block text-title">{name}</span>
                    <span className="mt-1 block text-body text-muted-foreground">{meaning}</span>
                  </span>
                  <code className="col-start-2 font-mono text-meta text-faint sm:col-start-3 sm:pt-1.5">{code}</code>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* 03 — Agent notes: a page from the journal */}
        <section id="reflections" className="scroll-mt-16 border-t border-border py-28 md:py-36">
          <div className="mx-auto max-w-6xl px-5 md:px-8">
            <Reveal className="mx-auto max-w-3xl">
              <Label n="03">{l.notes.label}</Label>
              <h2 className="mt-8 text-section text-balance">{l.notes.title}</h2>
              <p className="mt-5 max-w-lg text-body text-muted-foreground">{l.notes.body}</p>
              {t.common.originalLanguage && <p className="mt-3 max-w-lg text-small text-faint">{t.common.originalLanguage}</p>}
            </Reveal>
            <div className="mt-16"><ReflectionsShowcase /></div>
            <Reveal className="mx-auto mt-14 max-w-3xl">
              <Link href="/reflections" className="group inline-flex items-center gap-2 text-small text-muted-foreground hover:text-foreground">
                {l.notes.read} <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Reveal>
          </div>
        </section>

        {/* 04 — Research: five measures, side by side */}
        <section id="research" className="scroll-mt-16 border-t border-border py-28 md:py-36">
          <div className="mx-auto max-w-6xl px-5 md:px-8">
            <div className="grid gap-10 md:grid-cols-2">
              <Reveal>
                <Label n="04">{l.research.label}</Label>
                <h2 className="mt-8 text-section text-balance">{l.research.title}</h2>
              </Reveal>
              <Reveal delay={0.06} className="md:pt-16">
                <p className="text-body text-muted-foreground">{l.research.body}</p>
              </Reveal>
            </div>
            <dl className="mt-16 grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-5">
              {l.research.measures.map(({ name, def }, i) => (
                <Reveal key={name} delay={0.04 * i} className="bg-background py-6 pr-6 sm:px-5 lg:first:pl-0">
                  <dt className="text-ui font-medium hyphens-auto">{name}</dt>
                  <dd className="mt-2 text-small text-muted-foreground">{def}</dd>
                </Reveal>
              ))}
            </dl>
            <Reveal>
              <p className="mt-14 max-w-2xl border-l border-sage/60 pl-5 text-ui">{l.research.disclaimer}</p>
              <Link href="/research" className="group mt-6 inline-flex items-center gap-2 pl-5 text-small text-muted-foreground hover:text-foreground">
                {l.research.open} <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Reveal>
          </div>
        </section>

        {/* 05 — Oversight: principles as a stacked list */}
        <section id="oversight" className="scroll-mt-16 border-t border-border py-28 md:py-36">
          <div className="mx-auto max-w-6xl px-5 md:px-8">
            <Reveal>
              <Label n="05">{l.oversight.label}</Label>
              <h2 className="mt-8 max-w-2xl text-section text-balance">{l.oversight.title}</h2>
            </Reveal>
            <ol className="mt-14">
              {l.oversight.principles.map(({ title, body }, i) => (
                <Reveal as="li" key={title} delay={0.04 * i} className="grid gap-2 border-t border-border py-7 md:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)] md:items-baseline">
                  <span className="font-mono text-meta text-faint">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-h2 font-medium">{title}</span>
                  <span className="text-body text-muted-foreground">{body}</span>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* Close */}
        <section className="border-t border-border py-28 text-center md:py-36">
          <Reveal className="mx-auto max-w-xl px-5">
            <h2 className="text-section">{l.close.title}</h2>
            <p className="mt-4 text-body text-muted-foreground">{l.close.body}</p>
            <Button asChild size="lg" className="mt-8 h-10 px-5"><Link href="/sanctuary">{l.explore} <ArrowRightIcon /></Link></Button>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-8 text-small text-faint md:flex-row md:items-center md:justify-between md:px-8">
          <div className="flex items-center gap-4">
            <Wordmark />
            <span>{l.footer.proto}</span>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label={l.footer.label}>
            <Link href="/sanctuary" className="hover:text-foreground">{t.nav.items.sanctuary.label}</Link>
            <Link href="/reflections" className="hover:text-foreground">{t.nav.items.reflections.label}</Link>
            <Link href="/research" className="hover:text-foreground">{t.nav.items.research.label}</Link>
            <Link href="/developers" className="hover:text-foreground">{t.nav.items.developers.label}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
