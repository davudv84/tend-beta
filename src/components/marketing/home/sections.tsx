"use client";

import Link from "next/link";
import { ArrowRightIcon, CheckIcon, MinusIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { BRAND_ICONS } from "@/lib/brand-icons";
import { INTEGRATIONS, statusOf, type IntegrationCategory, type IntegrationId } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/ui/brand-mark";
import { DemoButton } from "@/ui/demo-button";
import { HeroBackdrop } from "../hero-backdrop";
import { Band, Container, PrimaryLink, QuietLink } from "../kit";
import { Reveal } from "../reveal";
import { darkSet, place, type Crop, type ScreenName } from "./screens";

/**
 * The homepage after the passage, one idea per section: why TEND exists, what you control, the moment that matters in the real app,
 * how to start, what it works with, and what the beta does and doesn't do. Sections alternate between two near-black tones instead
 * of rules between them. Every claim follows docs/security-limitations.md, docs/connect.md and the integrations catalog.
 */

type Tone = "base" | "deep";
const TONE: Record<Tone, string> = { base: "bg-[#181818]", deep: "bg-[#131313]" };
const pad = "py-24 md:py-36";
const display = "mk-display text-[clamp(2.25rem,4.6vw,3.75rem)]";
const lead = "text-[17px] leading-[1.55] text-foreground/65 md:text-[18px]";

/** A section's head: the title on the left, its one sentence on the right, aligned to the title's last line (stacked on a phone). */
function Head({ id, title, body, center, className }: { id: string; title: string; body?: string; center?: boolean; className?: string }) {
  if (center) {
    return (
      <div className={cn("mx-auto max-w-[780px] text-center", className)}>
        <h2 id={id} className={display}>{title}</h2>
        {body && <p className={cn(lead, "mx-auto mt-6 max-w-[54ch]")}>{body}</p>}
      </div>
    );
  }
  return (
    <div className={cn("grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-10", className)}>
      <h2 id={id} className={cn(display, "max-w-[17ch] lg:col-span-7")}>{title}</h2>
      {body && <p className={cn(lead, "max-w-[46ch] lg:col-span-5 lg:pb-2")}>{body}</p>}
    </div>
  );
}

/** The one link style of the homepage's sections: words and an arrow that moves a little on hover. */
function TextLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("group inline-flex min-h-11 items-center gap-1.5 rounded-sm text-[15px] font-medium text-foreground/85 outline-none transition-colors hover:text-foreground", className)}>
      {children}<ArrowRightIcon className="size-3.5 transition-transform duration-300 ease-[var(--ease-out)] group-hover:translate-x-1" strokeWidth={2} aria-hidden />
    </Link>
  );
}

/** A real screen of the app (dark theme), cropped to `crop` and filling a frame of the given aspect. */
function ScreenCrop({ name, crop, aspect, alt, sizes, className }: { name: ScreenName; crop: Crop; aspect: number; alt: string; sizes: string; className?: string }) {
  const set = darkSet(name);
  const [l, t, w, h] = place(name, crop, aspect).img;
  return (
    <div className={cn("relative overflow-hidden bg-[#181818]", className)} style={{ aspectRatio: aspect }}>
      <picture className="contents">
        <source type="image/avif" srcSet={set.avif} sizes={sizes} />
        <img src={set.src} srcSet={set.webp} sizes={sizes} alt={alt} loading="lazy" decoding="async" className="absolute max-w-none" style={{ left: l, top: t, width: w, height: h }} />
      </picture>
    </div>
  );
}

// ——— Why ———

/** The whole idea as one line of three: the agent asks, TEND answers by your rules, the tool runs only on a yes. */
export function Why() {
  const w = useT().land.why;
  const card = "rounded-2xl border border-white/[0.09] bg-[#1d1d1d] p-6";
  const verdicts = [["allow", "bg-sage"], ["ask", "bg-amber"], ["never", "bg-clay"]] as const;
  return (
    <Band label="why-title" line={false} className={TONE.base}>
      <Container className={pad}>
        <Head id="why-title" title={w.title} body={w.body} />
        <Reveal className="mt-16 md:mt-20">
          <div role="img" aria-label={w.diagram} className="grid items-center gap-0 lg:grid-cols-[minmax(0,1fr)_72px_minmax(0,1.15fr)_72px_minmax(0,1fr)]">
            <div className={card}>
              <p className="text-[13px] text-foreground/55">{w.agent}</p>
              <p className="mt-3 text-[15px] text-foreground/80">{w.asks}</p>
              <p className="mt-2 truncate rounded-lg border border-white/[0.08] bg-[#151515] px-3 py-2 font-mono text-[13px] text-foreground/90">{w.code}</p>
            </div>
            <Flow />
            <div className="relative overflow-hidden rounded-2xl border border-sage/35 bg-[#1b1d1c] p-6 shadow-[0_30px_60px_-30px_rgb(0_0_0/0.9)]">
              <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgb(95_184_146/0.10),transparent)]" />
              <p className="relative flex items-center gap-2.5 text-[15px] font-medium text-foreground"><BrandMark className="size-5 text-sage" />{w.tend}</p>
              <ul className="relative mt-4 divide-y divide-white/[0.07] border-t border-white/[0.07]">
                {verdicts.map(([k, dot]) => (
                  <li key={k} className="flex items-center gap-3 py-2.5 text-[15px] text-foreground/85"><span aria-hidden className={cn("size-2 rounded-full", dot)} />{w.verdicts[k]}</li>
                ))}
              </ul>
            </div>
            <Flow />
            <div className={card}>
              <p className="text-[13px] text-foreground/55">{w.tools}</p>
              <p className="mt-3 text-[17px] leading-snug text-foreground/90">{w.runs}</p>
            </div>
          </div>
        </Reveal>
      </Container>
    </Band>
  );
}

/** The line between two steps, with a request travelling along it (still under reduced motion). */
function Flow() {
  return (
    <div aria-hidden className="relative mx-auto flex h-12 w-px items-center justify-center lg:h-px lg:w-full">
      <span className="absolute inset-0 bg-white/20" />
      <span className="mk-flow-dot absolute size-1.5 rounded-full bg-sage" />
    </div>
  );
}

// ——— What you control ———

const CONTROL: { key: "agents" | "rules" | "activity"; shot: ScreenName; crop: Crop }[] = [
  { key: "agents", shot: "agents", crop: [19.5, 16, 33] },
  { key: "rules", shot: "policies-edit", crop: [2, 32.5, 46] },
  { key: "activity", shot: "activity", crop: [28.5, 43.6, 41] },
];

/** Three controls, each shown on the real screen where it lives. */
export function Control() {
  const t = useT();
  const c = t.land.control;
  const alts = t.land.passage.alts;
  const alt = { agents: t.front.shots.agents, rules: alts.rules, activity: alts.activity };
  return (
    <Band label="control-title" line={false} className={TONE.deep}>
      <Container className={pad}>
        <Head id="control-title" title={c.title} />
        <ul className="mt-14 grid gap-12 md:mt-20 md:grid-cols-3 md:gap-8 lg:gap-10">
          {CONTROL.map(({ key, shot, crop }, i) => (
            <Reveal as="li" key={key} delay={i * 80}>
              <div className="rounded-2xl border border-white/[0.09] bg-[#1a1a1a] p-1.5 shadow-[0_30px_60px_-34px_rgb(0_0_0/0.9)]">
                <ScreenCrop name={shot} crop={crop} aspect={4 / 3} alt={alt[key]} sizes="(min-width: 768px) 32vw, 92vw" className="rounded-[11px]" />
              </div>
              <h3 className="mt-7 text-[20px] font-medium tracking-[-0.015em]">{c.items[key][0]}</h3>
              <p className="mt-2 max-w-[36ch] text-[15.5px] leading-[1.55] text-foreground/65">{c.items[key][1]}</p>
              <TextLink href={`/product/${key}`} className="mt-3">{t.front.product[key].name}</TextLink>
            </Reveal>
          ))}
        </ul>
      </Container>
    </Band>
  );
}

// ——— The product ———

/** Where the three notes point on the Overview screenshot, in % of it: the request, the rule, and Allow once. */
const CALLOUTS = [["request", 67.8], ["rule", 73.7], ["once", 80]] as const;
/** The right edge of the waiting request's card on that screenshot, where the notes' lines start. */
const CARD_EDGE = 57.6;

/** The real product at the moment that matters, large: a request waiting for a person, with three notes on what you see. */
export function ProductView() {
  const t = useT();
  const v = t.land.view;
  return (
    <Band label="view-title" line={false} className={cn(TONE.base, "relative isolate overflow-hidden")}>
      <div aria-hidden className="absolute inset-x-0 top-[38%] -z-10 h-[60%] bg-[radial-gradient(50%_50%_at_50%_50%,rgb(95_184_146/0.07),transparent_70%)]" />
      <Container className={pad}>
        <Head id="view-title" title={v.title} body={v.body} center />
        {/* The desktop app from a tablet up; on a phone, the app's own phone screen, which can be read at that size. */}
        <Reveal className="mx-auto mt-14 hidden max-w-[1180px] md:mt-20 md:block">
          <figure className="rounded-[22px] border border-white/[0.1] bg-[#121212] p-2 shadow-[0_60px_120px_-50px_rgb(0_0_0/0.95)]">
            <div className="relative overflow-hidden rounded-[15px]">
              <ScreenCrop name="story-2" crop={[0, 0, 100]} aspect={1.6} alt={v.alt} sizes="(min-width: 1240px) 1180px, 94vw" />
              <div aria-hidden className="absolute inset-0 hidden lg:block">
                {CALLOUTS.map(([k, y]) => (
                  <div key={k} className="absolute flex items-center" style={{ left: `${CARD_EDGE}%`, top: `${y}%`, transform: "translateY(-50%)" }}>
                    <span className="size-1.5 rounded-full bg-sage" />
                    <span className="h-px w-12 bg-sage/60 xl:w-16" />
                    <span className="ml-3 rounded-md border border-white/[0.1] bg-[#121212]/90 px-2.5 py-1 text-[13.5px] whitespace-nowrap text-foreground/90 backdrop-blur-sm">{v.callouts[k]}</span>
                  </div>
                ))}
              </div>
            </div>
          </figure>
          {/* The same notes for everyone who doesn't see the drawing. */}
          <ul className="sr-only">{CALLOUTS.map(([k]) => <li key={k}>{v.callouts[k]}</li>)}</ul>
        </Reveal>
        <Reveal className="mx-auto mt-12 w-[min(80vw,330px)] md:hidden">
          <div className="overflow-hidden rounded-[38px] border-[6px] border-[#262626] shadow-[0_40px_80px_-30px_rgb(0_0_0/0.95)]">
            <ScreenCrop name="phone-approvals" crop={[0, 0, 100]} aspect={1170 / 2532} alt={t.front.shots["phone-approvals"]} sizes="330px" />
          </div>
        </Reveal>
        <div className="mt-10 flex justify-center">
          <TextLink href="/product/approvals">{v.link}</TextLink>
        </div>
      </Container>
    </Band>
  );
}

// ——— How to start ———

/** The three steps of the guided setup on one track, each with the action that starts it. */
export function Start({ accounts, demo }: { accounts: boolean; demo: boolean }) {
  const t = useT();
  const s = t.land.start;
  const create = accounts ? "/account/sign-up" : "/operator";
  const action = [
    demo ? <DemoButton key="a" note={false} /> : <PrimaryLink key="a" href={create}>{t.front.create}</PrimaryLink>,
    <TextLink key="b" href="/docs">{s.docs}</TextLink>,
    <TextLink key="c" href="/product/rules">{t.front.product.rules.name}</TextLink>,
  ];
  return (
    <Band label="start-title" line={false} className={TONE.deep}>
      <Container className={pad}>
        <Head id="start-title" title={s.title} body={s.body} />
        <ol className="relative mt-16 grid gap-12 md:mt-20 md:grid-cols-3 md:gap-8">
          {/* The track the three steps sit on. */}
          <span aria-hidden className="absolute top-[18px] right-0 left-0 hidden h-px bg-[linear-gradient(90deg,rgb(95_184_146/0.6),rgb(255_255_255/0.14)_40%,rgb(255_255_255/0.14))] md:block" />
          {s.steps.map((st, i) => (
            <Reveal as="li" key={st.title} delay={i * 90} className="relative">
              <span className={cn("relative grid size-9 place-items-center rounded-full border text-[14px] font-medium tabular-nums", i === 0 ? "border-sage/70 bg-[#17201c] text-sage" : "border-white/[0.16] bg-[#131313] text-foreground/75")}>{i + 1}</span>
              <h3 className="mt-6 text-[21px] font-medium tracking-[-0.015em]">{st.title}</h3>
              <p className="mt-2 max-w-[32ch] text-[15.5px] leading-[1.55] text-foreground/65">{"demo" in st && demo ? st.demo : st.body}</p>
              <div className="mt-5 flex">{action[i]}</div>
            </Reveal>
          ))}
        </ol>
      </Container>
    </Band>
  );
}

// ——— What it works with ———

/** The order verified integrations are named in: the agents people run first, then frameworks, then the plain protocols. */
const ORDER: IntegrationId[] = ["claudeCode", "claude", "openai", "mcp", "langchain", "langgraph", "crewai", "autogen", "pydanticAi", "mastra", "ollama", "http", "openaiCompatible"];
/** The verified ones in three columns by the catalog's own categories. */
const GROUPS: ["agents" | "frameworks" | "protocols", IntegrationCategory[]][] = [["agents", ["agent", "provider"]], ["frameworks", ["framework"]], ["protocols", ["protocol"]]];
const rank = (id: IntegrationId) => { const i = ORDER.indexOf(id); return i < 0 ? ORDER.length : i; };

/** What TEND works with, straight from the catalog and its verification report: verified ones, then the rest, labelled as such. */
export function Works() {
  const t = useT();
  const k = t.land.works;
  const by = (ok: (s: string) => boolean) => INTEGRATIONS.filter((i) => ok(statusOf(i))).sort((a, b) => rank(a.id) - rank(b.id));
  const verified = by((s) => s === "verified");
  const implemented = by((s) => s === "compatible" || s === "blocked");
  const planned = by((s) => s === "planned");
  return (
    <Band label="works-title" line={false} className={TONE.base}>
      <Container className={pad}>
        <Head id="works-title" title={k.title} body={k.body} />
        <Reveal className="mt-14 md:mt-20">
          <p className="flex items-center gap-2 text-[14px] text-foreground/70"><CheckIcon className="size-4 text-sage" strokeWidth={2.25} aria-hidden />{k.verified} · {verified.length}</p>
          <div className="mt-6 grid gap-10 md:grid-cols-2 md:gap-8 lg:grid-cols-3">
            {GROUPS.map(([g, cats]) => {
              const list = verified.filter((i) => cats.includes(i.category));
              if (!list.length) return null;
              return (
                <div key={g}>
                  <h3 className="text-[13px] text-foreground/55">{k.groups[g]}</h3>
                  <ul className="mt-3 divide-y divide-white/[0.07] border-y border-white/[0.07]">
                    {list.map((i) => (
                      <li key={i.id} className="flex min-h-[52px] items-center gap-3">
                        {i.logo ? (
                          <svg aria-hidden viewBox="0 0 24 24" className="size-[18px] shrink-0 fill-current text-foreground/85"><path d={BRAND_ICONS[i.logo].path} /></svg>
                        ) : (
                          <span aria-hidden className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-white/[0.08] text-[10.5px] font-semibold text-foreground/70">{i.name[0]}</span>
                        )}
                        <span className="min-w-0 flex-1 truncate text-[15.5px] tracking-[-0.01em] text-foreground/90">{i.name}</span>
                        <CheckIcon className="size-4 shrink-0 text-sage" strokeWidth={2.25} aria-label={k.verified} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </Reveal>
        <div className="mt-12 grid gap-8 border-t border-white/[0.08] pt-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-12">
          <div className="grid gap-6">
            {([[k.notTested, implemented], [k.planned, planned]] as const).filter(([, l]) => l.length).map(([label, list]) => (
              <div key={label}>
                <p className="text-[14px] text-foreground/60">{label}</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {list.map((i) => <li key={i.id} className="rounded-full border border-dashed border-white/[0.16] px-3 py-1 text-[13.5px] text-foreground/65">{i.name}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <TextLink href="/verification-report">{k.report}</TextLink>
        </div>
      </Container>
    </Band>
  );
}

// ——— Trust ———

/** The beta, said plainly: what TEND does today (tested) and what it doesn't, side by side, with the documents behind them. */
export function Trust() {
  const r = useT().land.trust;
  const links = [[r.links.limits, "/security"], [r.links.threat, "/threat-model"], [r.links.report, "/verification-report"]] as const;
  const lists = [[r.doesTitle, r.does, true], [r.notTitle, r.not, false]] as const;
  return (
    <Band label="trust-title" line={false} className={TONE.deep}>
      <Container className={pad}>
        <p className="inline-flex items-center gap-2 rounded-full border border-amber/30 bg-amber/[0.08] px-3 py-1 text-[13px] text-amber"><span aria-hidden className="size-1.5 rounded-full bg-amber" />{r.badge}</p>
        <Head id="trust-title" title={r.title} body={r.body} className="mt-6" />
        <div className="mt-14 grid gap-4 md:mt-20 md:grid-cols-2">
          {lists.map(([h, list, yes], n) => (
            <Reveal key={h} delay={n * 80} className="rounded-2xl border border-white/[0.08] bg-[#1a1a1a] p-7 md:p-9">
              <h3 className="flex items-center gap-3 text-[17px] font-medium">
                <span aria-hidden className={cn("grid size-7 place-items-center rounded-full", yes ? "bg-sage/15 text-sage" : "bg-white/[0.07] text-foreground/70")}>
                  {yes ? <CheckIcon className="size-4" strokeWidth={2.5} /> : <MinusIcon className="size-4" strokeWidth={2.5} />}
                </span>
                {h}
              </h3>
              <ul className="mt-6 divide-y divide-white/[0.07]">
                {list.map((x) => <li key={x} className="py-3.5 text-[16px] leading-[1.5] text-foreground/85 first:pt-0 last:pb-0">{x}</li>)}
              </ul>
            </Reveal>
          ))}
        </div>
        <ul className="mt-10 flex flex-wrap gap-x-8 gap-y-1">
          {links.map(([label, href]) => <li key={href}><TextLink href={href}>{label}</TextLink></li>)}
        </ul>
      </Container>
    </Band>
  );
}

// ——— The last word ———

/** The last word, in the hero's room: the dark gateway, the mark, two lines, one sentence and the main action. */
export function Closing({ accounts, demo }: { accounts: boolean; demo: boolean }) {
  const t = useT();
  const f = t.front;
  const c = t.land.closing;
  const create = accounts ? "/account/sign-up" : "/operator";
  return (
    <Band label="closing-title" line={false} className={cn(TONE.base, "relative isolate overflow-hidden")}>
      <HeroBackdrop />
      <Container className="py-32 text-center md:py-48">
        <BrandMark className="mx-auto size-10 text-sage" />
        <h2 id="closing-title" className="mk-display mx-auto mt-8 max-w-[18ch] text-[clamp(2.6rem,6vw,4.75rem)]">{f.closing.title.map((l, i) => <span key={l} className="block">{l}{i === 0 ? " " : ""}</span>)}</h2>
        <p className={cn(lead, "mx-auto mt-6 max-w-[44ch]")}>{demo ? c.bodyDemo : c.body}</p>
        <div className="mt-10 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
          {demo ? <DemoButton note={false} /> : <PrimaryLink href={create} size="lg">{f.create}</PrimaryLink>}
          <QuietLink href="/docs" size="lg" className="bg-[#181818]/40 backdrop-blur-sm">{c.docs}</QuietLink>
        </div>
      </Container>
    </Band>
  );
}
