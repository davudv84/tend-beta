"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon, KeyRoundIcon, XIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { BRAND_ICONS } from "@/lib/brand-icons";
import { SCENARIOS, type IntegrationId } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import { DemoButton } from "@/ui/demo-button";
import { VERIFIED } from "./hero";
import { Band, Container, ExploreLink, PrimaryLink, QuietLink, Screen, Terminal, prefersReducedMotion } from "./kit";
import { Painting } from "./landscape";
import { LazyMount } from "./lazy";
import type { Stage } from "./panels/rules";
import { Reveal } from "./reveal";
import { TERMINALS } from "./site-data";
import { SITE } from "./site";

// The screens further down load when someone scrolls toward them (LazyMount), so they stay off the first paint.
const ActivityPanel = dynamic(() => import("./panels/activity").then((x) => x.ActivityPanel), { ssr: false });
const AgentsPanel = dynamic(() => import("./panels/agents").then((x) => x.AgentsPanel), { ssr: false });
const IntegrationsPanel = dynamic(() => import("./panels/agents").then((x) => x.IntegrationsPanel), { ssr: false });
const ChecksPanel = dynamic(() => import("./panels/checks").then((x) => x.ChecksPanel), { ssr: false });
const TryCall = dynamic(() => import("./panels/rules").then((x) => x.TryCall), { ssr: false });

/** Six for "Works with": these first, if verified, then any other verified one with an official mark. */
const PREFERRED: IntegrationId[] = ["claudeCode", "claude", "mcp", "langchain", "crewai", "ollama"];
const WORKS_WITH = [...PREFERRED.map((id) => VERIFIED.find((i) => i.id === id)), ...VERIFIED.filter((i) => i.logo && !PREFERRED.includes(i.id))].filter((i) => !!i).slice(0, 6);

/**
 * A number that counts up once when it scrolls into view. The page renders the real value (for readers without JavaScript, search
 * engines and anyone who prefers reduced motion); only a counter that starts below the fold is set back to zero, one frame later,
 * and counted up when it is seen. Its width is fixed to its final digits, so nothing beside it moves.
 */
function Counter({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(to);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || el.getBoundingClientRect().top < innerHeight) return;
    let frame = requestAnimationFrame(() => setN(0));
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const length = 900;
      const tick = (now: number) => {
        const k = Math.min(1, (now - start) / length);
        setN(Math.round((1 - Math.pow(1 - k, 3)) * to));
        if (k < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, { rootMargin: "0px 0px -15% 0px" });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(frame); };
  }, [to]);
  return (
    <>
      <span ref={ref} aria-hidden className="inline-block tabular-nums" style={{ minWidth: `${String(to).length}ch` }}>{n}</span>
      <span className="sr-only">{to}</span>
    </>
  );
}

/**
 * Proof, and only what TEND's own tests show: what it works with, three counted facts, and where to check them (the verification
 * report, the changelog and the source). Never a customer count or a badge.
 */
export function Proof() {
  const t = useT();
  const p = t.front.proof;
  const facts: [number, string][] = [[VERIFIED.length, p.integrations], [SCENARIOS.length, p.scenarios], [1, p.once]];
  return (
    <Band label="proof-title">
      <Container className="py-14 md:py-20">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <p className="shrink-0 text-[13px] whitespace-nowrap text-muted-foreground">{t.front.hero.worksWith}</p>
          <ul className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 md:flex md:flex-wrap md:items-center md:gap-x-9">
            {WORKS_WITH.map((i) => (
              <li key={i.id} className="flex items-center gap-2.5 text-foreground/70">
                {i.logo && <svg aria-hidden viewBox="0 0 24 24" className="size-5 shrink-0 fill-current"><path d={BRAND_ICONS[i.logo].path} /></svg>}
                <span className="text-[15px] font-medium tracking-[-0.01em]">{i.name}</span>
              </li>
            ))}
          </ul>
        </div>
        <h2 id="proof-title" className="mt-14 text-[13px] text-muted-foreground md:mt-16">{p.label}</h2>
        <dl className="mt-5 grid border-y border-white/[0.08] sm:grid-cols-3 sm:divide-x sm:divide-white/[0.08]">
          {facts.map(([n, label]) => (
            <div key={label} className="flex flex-col-reverse gap-2 border-b border-white/[0.08] py-7 last:border-b-0 sm:border-b-0 sm:px-8 sm:first:pl-0">
              <dt className="max-w-[26ch] text-[14px] leading-snug text-muted-foreground">{label}</dt>
              <dd className="mk-display text-[clamp(3.25rem,6vw,4.5rem)]"><Counter to={n} /></dd>
            </div>
          ))}
        </dl>
        <div className="mt-8 flex flex-wrap gap-2.5">
          <ExploreLink href="/verification-report">{p.report}</ExploreLink>
          <ExploreLink href="/changelog">{p.changelog}</ExploreLink>
          <a href={SITE.github} target="_blank" rel="noreferrer" className="mk-press group inline-flex h-8 pointer-coarse:h-11 items-center gap-1 rounded-full border border-white/[0.12] pr-2.5 pl-3.5 text-[13px] text-foreground/90 outline-none hover:bg-white/[0.06] hover:text-foreground">
            {p.github}<ArrowUpRightIcon className="size-3.5 text-muted-foreground" strokeWidth={2} aria-hidden />
          </a>
        </div>
      </Container>
    </Band>
  );
}

/** One tool call, played through once while the headline names each step; then the visitor picks calls themselves. */
export function TryIt() {
  const t = useT();
  const tc = t.front.tryCall;
  const reduce = useReducedMotion();
  const [stage, setStage] = useState<Stage>("ask");
  return (
    <Band id="product" label="try-title">
      <Container className="py-16 md:py-24">
        <div className="text-center">
          <h2 id="try-title" className="sr-only">{tc.title}</h2>
          <p aria-hidden className="mk-display text-[clamp(2.1rem,4.6vw,3.5rem)]">
            <AnimatePresence mode="wait" initial={false}>
              <m.span key={stage} className="block" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -10, transition: { duration: 0.16 } }}>{tc.steps[stage]}</m.span>
            </AnimatePresence>
          </p>
        </div>
        <Reveal className="mx-auto mt-10 max-w-[920px] rounded-2xl border border-white/[0.08] bg-mk-surface p-4 sm:p-8 md:mt-12"><LazyMount className="min-h-[860px] md:min-h-[520px]"><TryCall autoplay onStage={setStage} /></LazyMount></Reveal>
      </Container>
    </Band>
  );
}

const CARDS = ["activity", "agents", "checks", "cli", "integrations"] as const;
type CardKey = (typeof CARDS)[number];
const HREF: Record<CardKey, string> = { activity: "/product/activity", agents: "/product/agents", checks: "/product/checks", cli: "/docs", integrations: "/verification-report" };
/** An app screen in a card, at its real layout and made smaller. */
const SMALL = "w-[480px] md:w-[760px] [zoom:0.6]";

/**
 * Everything around the approval, each screen once: a row that snaps card by card, swiped on a phone and moved with the two arrows on
 * a desktop (each greyed out at its end). No copies and nothing moving by itself.
 */
export function Everything() {
  const t = useT();
  const e = t.front.everything;
  const strip = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState<{ start: boolean; end: boolean }>({ start: true, end: false });
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const update = () => setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, []);
  const move = (dir: 1 | -1) => {
    const el = strip.current;
    const card = el?.querySelector("li");
    if (!el || !card) return;
    el.scrollBy({ left: dir * (card.getBoundingClientRect().width + 16), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };
  const screen = (k: CardKey) => {
    if (k === "activity" || k === "agents" || k === "checks") {
      const panel = k === "activity" ? <ActivityPanel /> : k === "agents" ? <AgentsPanel /> : <ChecksPanel />;
      return <Screen inner={SMALL} className="h-full rounded-tl-xl">{panel}</Screen>;
    }
    return <Screen inner="w-[calc(100%-1rem)]" className="h-full">{k === "cli" ? <Terminal {...TERMINALS.home} minHeight={200} compact /> : <IntegrationsPanel small />}</Screen>;
  };
  // The row starts where the page's content starts, runs to the window's edge, and snaps to the same line.
  const gutter = "px-5 scroll-px-5 sm:px-8 sm:scroll-px-8 xl:px-[calc((100vw-1200px)/2+2rem)] xl:scroll-px-[calc((100vw-1200px)/2+2rem)]";
  const arrow = "mk-press grid size-11 place-items-center rounded-full border border-white/[0.14] text-foreground/80 outline-none hover:bg-white/[0.06] disabled:pointer-events-none disabled:opacity-30";
  return (
    <Band id="features" label="everything-title">
      <div className="py-16 md:py-24">
        <Container className="flex items-end justify-between gap-6">
          <div>
            <h2 id="everything-title" className="mk-display max-w-[16ch] text-[clamp(2.1rem,4.4vw,3.4rem)]">{e.title}</h2>
            <p className="mt-3 text-[13px] text-muted-foreground md:hidden">{e.swipe}</p>
          </div>
          <div className="hidden gap-2 md:flex">
            <button type="button" onClick={() => move(-1)} disabled={edge.start} aria-label={e.prev} className={arrow}><ArrowLeftIcon className="size-4" strokeWidth={1.75} aria-hidden /></button>
            <button type="button" onClick={() => move(1)} disabled={edge.end} aria-label={e.next} className={arrow}><ArrowRightIcon className="size-4" strokeWidth={1.75} aria-hidden /></button>
          </div>
        </Container>
        <ul ref={strip} className={cn("mk-strip relative mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 md:mt-12", gutter)}>
          {CARDS.map((k) => (
            <li key={k} className="w-[82vw] max-w-[400px] shrink-0 snap-start sm:w-[400px]">
              <LazyMount margin="600px 1200px" className="h-[320px] overflow-hidden rounded-2xl border border-white/[0.08] bg-mk-surface pt-4 pl-4 [mask-image:linear-gradient(to_bottom,black_82%,transparent)]">{screen(k)}</LazyMount>
              <h3 className="mt-5 text-[17px] font-medium"><Link href={HREF[k]} className="group -my-2 inline-flex min-h-11 items-center gap-1 rounded-sm outline-none hover:underline hover:underline-offset-4">{e.cards[k][0]}<ArrowRightIcon className="size-3.5 opacity-60 transition-transform group-hover:translate-x-0.5" strokeWidth={2} aria-hidden /></Link></h3>
              <p className="mt-1 max-w-[34ch] text-[14px] leading-snug text-muted-foreground">{e.cards[k][1]}</p>
            </li>
          ))}
        </ul>
      </div>
    </Band>
  );
}

/* The four small diagrams of "How it holds". Drawn in HTML, so they scale with the text and read in both languages. */
const node = "rounded-lg border border-white/[0.1] bg-[#141414] px-3 py-2 text-center text-[12px] leading-tight";
function Arrow({ broken }: { broken?: boolean }) {
  return (
    <span aria-hidden className="relative flex h-px min-w-5 flex-1 items-center">
      <span className={cn("h-px w-full", broken ? "border-t border-dashed border-white/25" : "bg-white/30")} />
      {broken ? <XIcon className="absolute left-1/2 size-3.5 -translate-x-1/2 bg-mk-surface text-foreground/70" strokeWidth={2.25} /> : <span className="absolute right-0 size-1.5 rotate-45 border-t border-r border-white/40" />}
    </span>
  );
}
function BindingDiagram() {
  const d = useT().front.holds.diagram;
  const row = (label: string, text: string, hash: string, ok: boolean) => (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-lg border border-white/[0.08] bg-[#141414] px-3 py-2 lg:grid-cols-[72px_minmax(0,1fr)_auto]">
      <span className="col-span-2 text-[11px] text-muted-foreground lg:col-span-1">{label}</span>
      <span className="truncate font-mono text-[12px] text-foreground/85">{text}</span>
      <span className={cn("font-mono text-[11px]", ok ? "text-sage" : "text-foreground/50 line-through")}>{hash}</span>
    </div>
  );
  return (
    <div className="grid gap-2">
      {row(d.approved, "pay INV-118 4,800 EUR", "#a3f9e1", true)}
      {row(d.sent, "pay INV-118 48,000 EUR", "#7c210b", false)}
      <p className="mt-1 text-[12px] text-muted-foreground"><span className="font-mono">#a3f9e1 ≠ #7c210b</span> → {d.refused}</p>
    </div>
  );
}
function IsolationDiagram() {
  const d = useT().front.holds.diagram;
  return (
    <div className="flex items-center gap-2">
      <div className={node}>{d.agent}<span className="mt-1 block text-[11px] text-muted-foreground">{d.noKey}</span></div>
      <Arrow />
      <div className={cn(node, "border-sage/40")}>{d.tend}<span className="mt-1 flex items-center justify-center gap-1 text-[11px] text-sage"><KeyRoundIcon className="size-3" strokeWidth={2} aria-hidden />{d.key}</span></div>
      <Arrow />
      <div className={node}>{d.tool}<span className="mt-1 block text-[11px] text-muted-foreground">{d.ran}</span></div>
    </div>
  );
}
function FailDiagram() {
  const d = useT().front.holds.diagram;
  return (
    <div className="flex items-center gap-2">
      <div className={node}>{d.agent}</div>
      <Arrow />
      <div className={cn(node, "border-dashed text-foreground/60")}>{d.tend}<span className="mt-1 block text-[11px] text-muted-foreground">{d.down}</span></div>
      <Arrow broken />
      <div className={cn(node, "opacity-45")}>{d.tool}<span className="mt-1 block text-[11px] text-muted-foreground">{d.nothing}</span></div>
    </div>
  );
}
function LogDiagram() {
  const d = useT().front.holds.diagram;
  const entries = [["1", "a3f9", "0000", false], ["2", "7c21", "a3f9", false], ["3", "e04b", "7c21", true], ["4", "91d2", "e04b", false]] as const;
  return (
    <div>
      <div className="flex items-stretch gap-1.5">
        {entries.map(([n, hash, prev, edited], i) => (
          <div key={n} className="flex flex-1 items-center gap-1.5">
            <div className={cn("flex-1 rounded-lg border bg-[#141414] px-2 py-1.5 font-mono text-[10.5px] leading-tight", edited ? "border-dashed border-white/30" : "border-white/[0.1]")}>
              <span className="block text-foreground/85">#{n} {hash}</span>
              <span className={cn("block", i === 3 ? "text-foreground/45 line-through" : "text-muted-foreground")}>↳ {prev}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-[12px] text-muted-foreground">#3 {d.edited.toLowerCase()} → #4 ↳ ≠ → {d.broken}</p>
    </div>
  );
}

const HOLDS = [
  ["binding", BindingDiagram, "/docs#approval-binding"],
  ["isolation", IsolationDiagram, "/docs#credential-isolation"],
  ["failClosed", FailDiagram, "/docs#fail-closed"],
  ["log", LogDiagram, "/docs#audit-log"],
] as const;

/**
 * "How it holds", for the technical reader: the four guarantees, one sentence and one small diagram each, each linked to where the
 * docs say exactly how. Under them, one calm line to what TEND doesn't do.
 */
export function Holds() {
  const t = useT();
  const h = t.front.holds;
  return (
    <Band id="how-it-holds" label="holds-title">
      <Container className="py-16 md:py-24">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-end md:gap-16">
          <h2 id="holds-title" className="mk-display text-[clamp(2.1rem,4.4vw,3.4rem)]">{h.title}</h2>
          <p className="max-w-[40ch] text-[16px] text-muted-foreground md:justify-self-end md:pb-2">{h.lead}</p>
        </div>
        <ul className="mt-10 grid gap-4 md:mt-14 md:grid-cols-2">
          {HOLDS.map(([key, Diagram, href], i) => (
            <Reveal as="li" key={key} delay={i * 60} className="flex flex-col rounded-2xl border border-white/[0.08] bg-mk-surface p-5 sm:p-7">
              <div aria-hidden className="flex min-h-[112px] flex-col justify-center">{<Diagram />}</div>
              <h3 className="mt-6 text-[18px] font-medium tracking-[-0.01em]">{h.items[key][0]}</h3>
              <p className="mt-1.5 max-w-[52ch] flex-1 text-[14.5px] leading-relaxed text-muted-foreground">{h.items[key][1]}</p>
              <Link href={href} className="group -mb-2 mt-3 inline-flex min-h-11 items-center gap-1 self-start rounded-sm text-[14px] font-medium text-foreground/90 outline-none hover:text-foreground">
                {h.docs}<ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2} aria-hidden />
              </Link>
            </Reveal>
          ))}
        </ul>
        <p className="mt-10 text-center">
          <Link href="/security#doesnt" className="group inline-flex min-h-11 items-center gap-1.5 rounded-sm text-[15px] text-muted-foreground outline-none hover:text-foreground">
            {h.doesnt}<ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2} aria-hidden />
          </Link>
        </p>
      </Container>
    </Band>
  );
}

/** The last word over the painted sky: two lines and the two buttons. The sky fades into the page above and the footer below. */
export function Closing({ accounts, demo }: { accounts: boolean; demo: boolean }) {
  const t = useT();
  const f = t.front;
  const create = accounts ? "/account/sign-up" : "/operator";
  return (
    <Band label="closing-title" className="relative isolate overflow-hidden">
      <Painting art="sky" alt={f.art.sky} className="-z-20" position="50% 40%" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,#181818_0%,rgb(24_24_24/0.35)_35%,rgb(24_24_24/0.35)_65%,#181818_100%)]" />
      <Container className="py-24 text-center md:py-36">
        <h2 id="closing-title" className="mk-display mx-auto text-[clamp(2.25rem,5.4vw,4rem)]">{f.closing.title.map((l, i) => <span key={l} className="block">{l}{i === 0 ? " " : ""}</span>)}</h2>
        <div className="mt-8 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
          {demo ? <DemoButton note={false} /> : <PrimaryLink href={create} size="lg">{f.create}</PrimaryLink>}
          {demo ? <QuietLink href={create} size="lg">{f.create}</QuietLink> : <QuietLink href="/how-it-works" size="lg">{f.hero.howItWorks}</QuietLink>}
        </div>
      </Container>
    </Band>
  );
}
