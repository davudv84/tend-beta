"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon, CircleCheckIcon, LinkIcon, LockIcon, MinusIcon, ScrollTextIcon, TicketCheckIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { SCENARIOS } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import { VERIFIED } from "./hero";
import { Band, Container, PrimaryLink, QuietLink, Screen, Terminal, prefersReducedMotion } from "./kit";
import { CLOSING_SIZES, Landscape } from "./landscape";
import { ActivityPanel } from "./panels/activity";
import { AgentsPanel, IntegrationsPanel } from "./panels/agents";
import { ApprovalsPanel } from "./panels/approvals";
import { ChecksPanel, GatewayMini } from "./panels/checks";
import { RulesPanel, TryCall, type Stage } from "./panels/rules";
import { Reveal } from "./reveal";
import { TERMINALS } from "./site-data";
import { DemoButton } from "@/ui/demo-button";

/** The statement on the left and three numbers on the right, each a fact about TEND, never a customer count. */
export function Stats() {
  const t = useT();
  const s = t.front.stats;
  const rows: [string, string][] = [[String(VERIFIED.length), s.integrations], [String(SCENARIOS.length), s.checks], ["1", s.once]];
  return (
    <Band>
      <Container className="grid gap-10 py-16 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] md:gap-16 md:py-24">
        <p className="mk-heading max-w-[24ch] text-[clamp(1.4rem,2.4vw,1.75rem)] leading-[1.3] text-foreground">{s.statement}</p>
        <dl className="divide-y divide-white/[0.08] border-y border-white/[0.08] md:border-t-0">
          {rows.map(([n, label]) => (
            <Reveal key={label} className="grid gap-2 py-7 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-center sm:gap-6 md:py-9">
              <dt className="mk-display order-1 text-[clamp(3.25rem,6vw,4.75rem)] tabular-nums">{n}</dt>
              <dd className="order-2 max-w-[34ch] text-[14px] leading-snug text-muted-foreground">{label}</dd>
            </Reveal>
          ))}
        </dl>
      </Container>
    </Band>
  );
}

const PLATFORM = [["decide", CircleCheckIcon, "/product/approvals"], ["prove", ScrollTextIcon, "/product/activity"]] as const;
/** An app screen in a card: at its real layout from 768px up, the phone's below, both a little smaller than life. */
const BIG = "w-[380px] md:w-[860px] [zoom:0.85]";
const SMALL = "w-[480px] md:w-[760px] [zoom:0.6]";

/**
 * "One checkpoint for every AI agent", laid out as sim.ai's platform section: two cards with the app's own screen in each, where the
 * card under the pointer (or holding the focus) widens and lights up and the other steps back; then the wide card, where one tool call
 * plays through once (an agent asks, TEND checks the rules, a person decides, it runs) while the headline names each step. After
 * that the visitor tries calls themselves. On a phone the two cards are stacked and both lit.
 */
export function Platform() {
  const t = useT();
  const p = t.front.platform;
  const tc = t.front.tryCall;
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [stage, setStage] = useState<Stage>("ask");
  const card = "relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-mk-surface";
  return (
    <Band id="product" label="platform-title">
      <Container className="py-16 md:py-24">
        <Reveal className="text-center">
          <h2 id="platform-title" className="mk-display mx-auto max-w-[18ch] text-[clamp(2.25rem,5vw,3.75rem)]">{p.title}</h2>
          <p className="mx-auto mt-5 max-w-[48ch] text-[16px] leading-relaxed text-muted-foreground">{p.body}</p>
        </Reveal>
        <Reveal className="mt-12 grid gap-4 md:mt-16 md:flex">
          {PLATFORM.map(([key, Icon, href], i) => {
            const on = active === i;
            return (
              <div key={key} onPointerEnter={() => setActive(i)} onFocus={() => setActive(i)}
                className={cn(card, "md:h-[580px] md:basis-0 md:transition-[flex-grow,background-color] md:duration-500 md:ease-out", on ? "md:grow-[1.7] md:bg-[#262626]" : "md:grow")}>
                <div className={cn("p-6 transition-opacity duration-500 md:p-8", !on && "md:opacity-40")}>
                  <Icon aria-hidden className="size-9 text-foreground/80" strokeWidth={1} />
                  <h3 className="mt-5 text-[22px] font-medium tracking-[-0.02em]"><Link href={href} className="outline-none hover:underline hover:underline-offset-4">{p[key].title}</Link></h3>
                  <p className="mt-2 max-w-[36ch] text-[15px] text-muted-foreground">{p[key].body}</p>
                </div>
                <Screen inner={BIG} className={cn("mt-auto ml-6 h-[320px] rounded-tl-xl transition-opacity duration-500 md:ml-8 md:h-auto md:flex-1", on ? "mk-rise" : "md:opacity-30")}>
                  {key === "decide" ? <ApprovalsPanel /> : <ActivityPanel />}
                </Screen>
              </div>
            );
          })}
        </Reveal>
        <Reveal className={cn(card, "mt-4 px-5 py-10 sm:px-8 md:px-12 md:py-14")}>
          <div className="text-center">
            <h3 className="mk-heading text-[clamp(1.75rem,3.4vw,2.5rem)]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={stage} className="block" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -10, transition: { duration: 0.16 } }}>{tc.steps[stage]}</motion.span>
              </AnimatePresence>
            </h3>
            <p className="mx-auto mt-3 max-w-[50ch] text-[15px] text-muted-foreground">{tc.body}</p>
          </div>
          <div className="mx-auto mt-10 max-w-[920px]"><TryCall autoplay onStage={setStage} /></div>
        </Reveal>
      </Container>
    </Band>
  );
}

const CARDS = ["approvals", "rules", "activity", "agents", "checks", "gateway", "cli", "integrations"] as const;
type CardKey = (typeof CARDS)[number];
const HREF: Record<CardKey, string> = {
  approvals: "/product/approvals", rules: "/product/rules", activity: "/product/activity", agents: "/product/agents", checks: "/product/checks",
  gateway: "/how-it-works#modes", cli: "/docs", integrations: "/verification-report",
};
/** The cards that show one of the app's screens, at its real layout and made smaller; the other three are drawn to fit the card. */
const APP_SCREEN: Partial<Record<CardKey, React.ReactNode>> = { approvals: <ApprovalsPanel />, rules: <RulesPanel />, activity: <ActivityPanel />, agents: <AgentsPanel />, checks: <ChecksPanel /> };
/** How fast the strip drifts by itself, in pixels a second. */
const DRIFT = 26;

/**
 * The strip of everything TEND has, each card with the app's screen in it, as sim.ai's "Everything AI agents need to do real work".
 * It has no end in either direction: the cards are drawn three times in a row and the strip stays inside the middle copy by stepping
 * one copy's width whenever it leaves it, which nobody can see because the copies are identical. It drifts slowly to the left by
 * itself and stops while the pointer or the focus is on it, for a moment after anyone scrolls it, when it is off screen, and for good
 * under reduced motion. The two outer copies are hidden from screen readers and the keyboard.
 * ponytail: one copy has to be wider than half the window (eight cards are about 3500px); add a fourth copy if cards are ever removed.
 */
export function Everything() {
  const t = useT();
  const e = t.front.everything;
  const strip = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const period = () => (el.children[CARDS.length] as HTMLElement).offsetLeft - (el.children[0] as HTMLElement).offsetLeft;
    const wrap = () => {
      const w = period();
      if (el.scrollLeft < w * 0.5) el.scrollLeft += w;
      else if (el.scrollLeft >= w * 1.5) el.scrollLeft -= w;
    };
    el.scrollLeft = period();
    let idle = 0;
    const onScroll = () => { clearTimeout(idle); idle = window.setTimeout(wrap, 150); };
    el.addEventListener("scroll", onScroll, { passive: true });

    let frame = 0, last = 0, pos = el.scrollLeft, wrote = el.scrollLeft, quietUntil = 0, visible = false, held = false;
    // The pointer or the focus is on it: it stays where it is.
    const hold = () => { held = true; };
    const release = () => { held = false; };
    const on = [["pointerenter", hold], ["pointerleave", release], ["focusin", hold], ["focusout", release]] as const;
    for (const [name, fn] of on) el.addEventListener(name, fn);
    const io = new IntersectionObserver(([x]) => { visible = x.isIntersecting; });
    io.observe(el);
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      // Somebody moved it (a swipe, the wheel, an arrow): leave it alone for a moment.
      if (Math.abs(el.scrollLeft - wrote) > 2) quietUntil = now + 2500;
      if (visible && !held && now > quietUntil) {
        const w = period();
        pos += (dt * DRIFT) / 1000;
        if (pos >= w * 1.5) pos -= w;
        el.scrollLeft = pos;
      } else pos = el.scrollLeft;
      wrote = el.scrollLeft;
      frame = requestAnimationFrame(tick);
    };
    if (!prefersReducedMotion()) frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(idle);
      io.disconnect();
      el.removeEventListener("scroll", onScroll);
      for (const [name, fn] of on) el.removeEventListener(name, fn);
    };
  }, []);
  const move = (dir: 1 | -1) => {
    const el = strip.current;
    const card = el?.querySelector("li");
    if (!el || !card) return;
    el.scrollBy({ left: dir * (card.getBoundingClientRect().width + 16), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };
  const screen = (k: CardKey) => {
    if (APP_SCREEN[k]) return <Screen inner={SMALL} className="h-full rounded-tl-xl">{APP_SCREEN[k]}</Screen>;
    const drawn = k === "gateway" ? <GatewayMini /> : k === "cli" ? <Terminal {...TERMINALS.home} minHeight={200} compact /> : <IntegrationsPanel small />;
    return <Screen inner="w-[calc(100%-1rem)]" className="h-full">{drawn}</Screen>;
  };
  // The strip starts where the page's content starts, and runs to the window's edge.
  const gutter = "px-5 sm:px-8 xl:px-[calc((100vw-1200px)/2+2rem)]";
  return (
    <Band id="features" label="everything-title">
      <div className="py-16 md:py-24">
        <Container className="flex items-end justify-between gap-6">
          <div>
            <h2 id="everything-title" className="mk-display max-w-[16ch] text-[clamp(2.1rem,4.4vw,3.4rem)]">{e.title}</h2>
            <p className="mt-3 text-[13px] text-muted-foreground md:hidden">{e.swipe}</p>
          </div>
          <div className="hidden gap-2 md:flex">
            <button type="button" onClick={() => move(-1)} aria-label={e.prev} className="grid size-9 place-items-center rounded-full border border-white/[0.14] text-foreground/80 outline-none hover:bg-white/[0.06]"><ArrowLeftIcon className="size-4" strokeWidth={1.75} aria-hidden /></button>
            <button type="button" onClick={() => move(1)} aria-label={e.next} className="grid size-9 place-items-center rounded-full border border-white/[0.14] text-foreground/80 outline-none hover:bg-white/[0.06]"><ArrowRightIcon className="size-4" strokeWidth={1.75} aria-hidden /></button>
          </div>
        </Container>
        <ul ref={strip} className={cn("mk-strip relative mt-10 flex gap-4 overflow-x-auto pb-2 md:mt-12", gutter)}>
          {[0, 1, 2].flatMap((copy) => CARDS.map((k) => (
            <li key={`${copy}-${k}`} aria-hidden={copy !== 1 || undefined} inert={copy !== 1} className="w-[82vw] max-w-[420px] shrink-0 sm:w-[420px]">
              <div className="h-[340px] overflow-hidden rounded-2xl border border-white/[0.08] bg-mk-surface pt-4 pl-4 [mask-image:linear-gradient(to_bottom,black_82%,transparent)]">{screen(k)}</div>
              <h3 className="mt-5 text-[17px] font-medium"><Link href={HREF[k]} className="group inline-flex items-center gap-1 outline-none hover:underline hover:underline-offset-4">{e.cards[k][0]}<ArrowRightIcon className="size-3.5 opacity-60 transition-transform group-hover:translate-x-0.5" strokeWidth={2} aria-hidden /></Link></h3>
              <p className="mt-1.5 max-w-[34ch] text-[14px] leading-snug text-muted-foreground">{e.cards[k][1]}</p>
            </li>
          )))}
        </ul>
      </div>
    </Band>
  );
}

/** What it controls and what it doesn't, in sim.ai's governance layout: three tall cards, then the limits in plain words. */
export function Governance() {
  const t = useT();
  const g = t.front.governance;
  const cards = [["failsClosed", LockIcon, "/security#does"], ["singleUse", TicketCheckIcon, "/product/approvals"], ["chain", LinkIcon, "/product/activity"]] as const;
  return (
    <Band id="security" label="governance-title">
      <Container className="py-16 md:py-24">
        <div className="grid gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-16">
          <h2 id="governance-title" className="mk-display max-w-[16ch] text-[clamp(2.1rem,4.4vw,3.4rem)]">{g.title}</h2>
          <div className="md:pt-2">
            <p className="max-w-[44ch] text-[16px] leading-relaxed text-muted-foreground">{g.body}</p>
            <QuietLink href="/security" className="mt-5">{g.button}</QuietLink>
          </div>
        </div>
        <ul className="mt-12 grid gap-4 sm:grid-cols-3 md:mt-16">
          {cards.map(([key, Icon, href], i) => (
            <Reveal as="li" key={key} delay={i * 70}>
              <Link href={href} className="mk-press group flex h-full items-center gap-5 rounded-2xl border border-white/[0.08] bg-mk-surface px-5 py-5 outline-none hover:border-white/[0.18] sm:min-h-[300px] sm:flex-col sm:justify-end sm:gap-0 sm:px-6 sm:pt-10 sm:pb-8 sm:text-center md:min-h-[380px]">
                <Icon aria-hidden className="size-14 shrink-0 text-foreground/75 sm:mb-auto sm:size-24 md:size-28" strokeWidth={0.75} />
                <span className="flex min-w-0 flex-col sm:mt-10 sm:items-center">
                  <span className="text-[17px] font-medium">{g.does[key]}</span>
                  <span className="mt-1 inline-flex items-center gap-1 text-[13px] text-muted-foreground group-hover:text-foreground sm:mt-1.5">{g.details}<ArrowUpRightIcon className="size-3.5" strokeWidth={1.75} aria-hidden /></span>
                </span>
              </Link>
            </Reveal>
          ))}
        </ul>
        <ul className="mt-4 grid border-y border-white/[0.08] sm:grid-cols-3 sm:divide-x sm:divide-white/[0.08]">
          {g.doesnt.map(([title, body]) => (
            <li key={title} className="border-b border-white/[0.08] px-1 py-7 last:border-b-0 sm:border-b-0 sm:px-6 sm:first:pl-0">
              <MinusIcon aria-hidden className="size-6 text-foreground/70" strokeWidth={1.25} />
              <p className="mt-4 text-[16px] font-medium">{title}</p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </Band>
  );
}

/** The last word: two lines, the two buttons, and the hills under them, as sim.ai ends on its city. */
export function Closing({ accounts, demo }: { accounts: boolean; demo: boolean }) {
  const t = useT();
  const f = t.front;
  return (
    <Band label="closing-title" className="relative isolate overflow-hidden">
      <Container className="relative z-10 pt-20 text-center md:pt-28">
        <h2 id="closing-title" className="mk-display mx-auto text-[clamp(2.25rem,5.4vw,4rem)]">{f.closing.title.map((l) => <span key={l} className="block">{l}</span>)}</h2>
        <div className="mt-8 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
          {demo ? <DemoButton note={false} /> : <PrimaryLink href={accounts ? "/account/sign-up" : "/operator"} size="lg">{f.create}</PrimaryLink>}
          {demo ? <QuietLink href={accounts ? "/account/sign-up" : "/operator"} size="lg">{f.create}</QuietLink> : <QuietLink href="/how-it-works" size="lg">{f.hero.howItWorks}</QuietLink>}
        </div>
      </Container>
      <div className="relative -mt-10 h-[340px] sm:h-[440px] md:h-[560px]">
        <Landscape painting alt={f.hero.landscape} position="center 58%" sizes={CLOSING_SIZES} mask="linear-gradient(to bottom, transparent, black 40%)" />
      </div>
    </Band>
  );
}
