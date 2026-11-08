"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon, CircleCheckIcon, LinkIcon, LockIcon, MinusIcon, ScrollTextIcon, TicketCheckIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { SCENARIOS } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import { VERIFIED } from "./hero";
import { Band, Container, PrimaryLink, QuietLink, Terminal } from "./kit";
import { Landscape } from "./landscape";
import { ActivityMini } from "./panels/activity";
import { AgentsMini, IntegrationsPanel } from "./panels/agents";
import { ApprovalsMini } from "./panels/approvals";
import { ChecksMini, GatewayMini } from "./panels/checks";
import { RulesMini, TryCall } from "./panels/rules";
import { Reveal } from "./reveal";
import { TERMINALS } from "./site-data";
import type { HomeImages } from "./types";

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
            <Reveal key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-6 py-7 md:py-9">
              <dt className="mk-display order-1 text-[clamp(3rem,6vw,4.75rem)] tabular-nums">{n}</dt>
              <dd className="order-2 text-[14px] leading-snug text-muted-foreground">{label}</dd>
            </Reveal>
          ))}
        </dl>
      </Container>
    </Band>
  );
}

/** "One checkpoint for every AI agent": two cards with a live screen each, then the big card where a visitor tries a call. */
export function Platform() {
  const t = useT();
  const p = t.front.platform;
  const tc = t.front.tryCall;
  const card = "relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-mk-surface";
  return (
    <Band id="product" label="platform-title">
      <Container className="py-16 md:py-24">
        <Reveal className="text-center">
          <h2 id="platform-title" className="mk-display mx-auto max-w-[18ch] text-[clamp(2.25rem,5vw,3.75rem)]">{p.title}</h2>
          <p className="mx-auto mt-5 max-w-[48ch] text-[16px] leading-relaxed text-muted-foreground">{p.body}</p>
        </Reveal>
        <div className="mt-12 grid gap-4 md:mt-16 md:grid-cols-2">
          {([["decide", CircleCheckIcon, <ApprovalsMini key="a" request="push" />, "/product/approvals"], ["prove", ScrollTextIcon, <ActivityMini key="b" />, "/product/activity"]] as const).map(([key, Icon, screen, href], i) => (
            <Reveal key={key} delay={i * 80} className={card}>
              <div className="p-6 md:p-8">
                <Icon aria-hidden className="size-9 text-foreground/80" strokeWidth={1} />
                <h3 className="mt-5 text-[22px] font-medium tracking-[-0.02em]"><Link href={href} className="outline-none hover:underline hover:underline-offset-4">{p[key].title}</Link></h3>
                <p className="mt-2 max-w-[40ch] text-[15px] text-muted-foreground">{p[key].body}</p>
              </div>
              <div className="mt-auto px-6 pb-6 md:px-8 md:pb-8"><div className="max-w-[440px]">{screen}</div></div>
            </Reveal>
          ))}
        </div>
        <Reveal className={cn(card, "mt-4 px-5 py-10 sm:px-8 md:px-12 md:py-14")}>
          <div className="text-center">
            <h3 className="mk-heading text-[clamp(1.75rem,3.4vw,2.5rem)]">{tc.title}</h3>
            <p className="mx-auto mt-3 max-w-[50ch] text-[15px] text-muted-foreground">{tc.body}</p>
          </div>
          <div className="mx-auto mt-10 max-w-[920px]"><TryCall /></div>
        </Reveal>
      </Container>
    </Band>
  );
}

const CARDS = ["approvals", "rules", "activity", "agents", "checks", "gateway", "cli", "integrations"] as const;
const HREF: Record<(typeof CARDS)[number], string> = {
  approvals: "/product/approvals", rules: "/product/rules", activity: "/product/activity", agents: "/product/agents", checks: "/product/checks",
  gateway: "/how-it-works#modes", cli: "/docs", integrations: "/verification-report",
};

/** The swipeable strip of everything TEND has, each with a live screen, as sim.ai's "Everything AI agents need to do real work". */
export function Everything() {
  const t = useT();
  const e = t.front.everything;
  const strip = useRef<HTMLUListElement>(null);
  const move = (dir: 1 | -1) => {
    const el = strip.current;
    const card = el?.querySelector("li");
    if (!el || !card) return;
    el.scrollBy({ left: dir * (card.getBoundingClientRect().width + 16), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const screen = (k: (typeof CARDS)[number]) => {
    switch (k) {
      case "approvals": return <ApprovalsMini />;
      case "rules": return <RulesMini />;
      case "activity": return <ActivityMini />;
      case "agents": return <AgentsMini />;
      case "checks": return <ChecksMini />;
      case "gateway": return <GatewayMini />;
      case "cli": return <Terminal {...TERMINALS.home} minHeight={200} compact />;
      case "integrations": return <IntegrationsPanel small />;
    }
  };
  // The strip starts where the page's content starts, and runs to the window's edge.
  const gutter = "px-5 scroll-px-5 sm:px-8 sm:scroll-px-8 xl:px-[calc((100vw-1200px)/2+2rem)] xl:scroll-px-[calc((100vw-1200px)/2+2rem)]";
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
          {CARDS.map((k) => (
            <li key={k} className="w-[82vw] max-w-[340px] shrink-0 snap-start sm:w-[320px]">
              <div className="flex h-[340px] items-start overflow-hidden rounded-2xl border border-white/[0.08] bg-mk-surface p-4 [mask-image:linear-gradient(to_bottom,black_82%,transparent)]">
                <div className="w-full">{screen(k)}</div>
              </div>
              <h3 className="mt-5 text-[17px] font-medium"><Link href={HREF[k]} className="group inline-flex items-center gap-1 outline-none hover:underline hover:underline-offset-4">{e.cards[k][0]}<ArrowRightIcon className="size-3.5 opacity-60 transition-transform group-hover:translate-x-0.5" strokeWidth={2} aria-hidden /></Link></h3>
              <p className="mt-1.5 max-w-[34ch] text-[14px] leading-snug text-muted-foreground">{e.cards[k][1]}</p>
            </li>
          ))}
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
              <Link href={href} className="group flex h-full min-h-[300px] flex-col items-center justify-end rounded-2xl border border-white/[0.08] bg-mk-surface px-6 pt-10 pb-8 text-center outline-none transition-colors hover:border-white/[0.18] md:min-h-[380px]">
                <Icon aria-hidden className="mb-auto size-24 text-foreground/75 md:size-28" strokeWidth={0.75} />
                <span className="mt-10 text-[17px] font-medium">{g.does[key]}</span>
                <span className="mt-1.5 inline-flex items-center gap-1 text-[13px] text-muted-foreground group-hover:text-foreground">{g.details}<ArrowUpRightIcon className="size-3.5" strokeWidth={1.75} aria-hidden /></span>
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
export function Closing({ accounts, images }: { accounts: boolean; images: HomeImages }) {
  const t = useT();
  const f = t.front;
  return (
    <Band label="closing-title" className="relative isolate overflow-hidden">
      <Container className="relative z-10 pt-20 text-center md:pt-28">
        <h2 id="closing-title" className="mk-display mx-auto text-[clamp(2.25rem,5.4vw,4rem)]">{f.closing.title.map((l) => <span key={l} className="block">{l}</span>)}</h2>
        <div className="mt-8 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
          <PrimaryLink href={accounts ? "/account/sign-up" : "/operator"} size="lg">{f.create}</PrimaryLink>
          <QuietLink href="/how-it-works" size="lg">{f.hero.howItWorks}</QuietLink>
        </div>
      </Container>
      <div className="relative -mt-10 h-[340px] sm:h-[440px] md:h-[560px]">
        <Landscape src={images.hero ?? images.footer} alt={f.hero.landscape} position="center 58%" sizes="100vw" mask="linear-gradient(to bottom, transparent, black 40%)" />
      </div>
    </Band>
  );
}
