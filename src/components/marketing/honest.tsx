"use client";

import { Fragment } from "react";
import { ArrowRightIcon, CheckIcon, MinusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./eyebrow";
import { pill } from "./pill";
import { Reveal } from "./reveal";

const DOES = ["failsClosed", "singleUse", "gateway"] as const;
const DOESNT = ["sandbox", "threats", "audit"] as const;
type Key = (typeof DOES)[number] | (typeof DOESNT)[number];

/** Where testimonials would be: what TEND does and what it does not, three cards each, in two offset rows with hatched tiles between. */
export function Honest() {
  const t = useT();
  const h = t.front.honest;
  return (
    <section id="security" aria-labelledby="honest-title" className="scroll-mt-24 overflow-hidden pt-24 md:pt-32">
      <Reveal className="mx-auto max-w-[1240px] px-6 text-center md:px-8">
        <Eyebrow>{h.eyebrow}</Eyebrow>
        <h2 id="honest-title" className="mx-auto mt-6 max-w-[22ch] font-serif text-[clamp(2.25rem,4.6vw,3.5rem)] leading-[1.08] font-light tracking-[-0.025em] text-balance">{h.title}</h2>
      </Reveal>
      <div className="mt-12 flex flex-col gap-4 md:mt-16">
        <Row heading={h.does} keys={DOES} Icon={CheckIcon} />
        <Row heading={h.doesnt} keys={DOESNT} Icon={MinusIcon} shift />
      </div>
      <Reveal className="mt-12 text-center">
        <Button asChild className={pill("light")}><a href="#">{h.button} <ArrowRightIcon className="size-4" aria-hidden /></a></Button>
      </Reveal>
    </section>
  );
}

function Row({ heading, keys, Icon, shift }: { heading: string; keys: readonly Key[]; Icon: typeof CheckIcon; shift?: boolean }) {
  const t = useT();
  const h = t.front.honest;
  // From 1280px up, a strip wider than the page: hatched tiles between the cards, the outer ones cut off, the second row shifted by
  // half a tile. Card and tile widths follow the window so every card stays whole at 1280 and at 1440. Narrower: a plain grid.
  return (
    <Reveal as="section" aria-label={heading} delay={shift ? 80 : 0} className="mx-auto w-full min-w-0 max-w-[1240px] px-6 xl:mx-0 xl:max-w-none xl:px-0">
      <h3 className="sr-only">{heading}</h3>
      <ul className={cn("grid gap-4 sm:grid-cols-2 xl:flex xl:justify-center xl:[--c:clamp(300px,23.6vw,340px)] xl:[--s:clamp(96px,7.6vw,110px)]", shift && "xl:translate-x-[calc((var(--s)+16px)/2)]")}>
        {keys.map((k) => (
          <Fragment key={k}>
            <Stripe />
            <li className="flex min-h-[200px] flex-col rounded-2xl border border-border bg-mk-surface p-6 xl:w-[var(--c)] xl:shrink-0">
              <p className="flex items-center gap-2 text-[12px] text-muted-foreground"><Icon className="size-3.5" strokeWidth={2} aria-hidden />{heading}</p>
              <p className="mt-4 text-[17px] font-medium tracking-[-0.01em] text-balance">{h[k].title}</p>
              <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{h[k].body}</p>
            </li>
          </Fragment>
        ))}
        <Stripe />
      </ul>
    </Reveal>
  );
}

const Stripe = () => <li aria-hidden className="mk-stripes hidden min-h-[200px] shrink-0 rounded-2xl border border-border xl:block xl:w-[var(--s)]" />;
