"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRightIcon, MailIcon } from "lucide-react";
import { LanguageSwitch } from "@/components/language-switch";
import { useT } from "@/i18n/client";
import { Landscape } from "./landscape";
import { Logo } from "./logo";
import { SITE } from "./site";
import type { HomeImages } from "./types";

type Item = [label: string, href: string];

/**
 * The footer: the logo and the way to get in touch, three columns of links (every one leads to a page), the newsletter pill (no backend yet),
 * the language, and hills rising at the bottom. Section links are written as `/#id`, so they work from every page of the site.
 */
export function Footer({ accounts, images }: { accounts: boolean; images: HomeImages }) {
  const t = useT();
  const f = t.front;
  const o = f.footer;
  const [note, setNote] = useState(false);
  const columns: [string, Item[]][] = [
    [o.columns.product, [[f.nav.product, "/how-it-works"], [f.nav.features, "/#features"], [f.nav.integrations, "/#integrations"], [f.nav.security, "/security"], [f.signIn, accounts ? "/account/sign-in" : "/operator"], ...(accounts ? [[f.create, "/account/sign-up"] as Item] : [])]],
    [o.columns.resources, [[o.links.limitations, "/security"], [o.links.report, "/verification-report"], [o.links.docs, "/docs"]]],
    [o.columns.company, [[o.links.about, "/about"], [o.links.contact, "/contact"], [o.links.imprint, "/imprint"]]],
  ];
  const link = "rounded-sm text-[14px] text-foreground/85 transition-colors hover:text-foreground";
  return (
    <footer className="relative mt-24 overflow-hidden md:mt-32">
      <Landscape src={images.footer} alt={o.landscape} tone="night" position="center bottom" className="top-auto h-[75%]" mask="linear-gradient(to bottom, transparent, black 65%)" />
      <div className="relative mx-auto max-w-[1240px] px-6 pt-16 pb-10 md:px-8 md:pt-20">
        <div className="grid gap-12 md:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
          <div>
            <Logo />
            <p className="mt-6 flex items-center gap-2.5 text-[14px]">
              <MailIcon className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              {SITE.contactEmail ? <a href={`mailto:${SITE.contactEmail}`} className={link}>{SITE.contactEmail}</a> : <Link href="/contact" className={link}>{o.links.contact}</Link>}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map(([title, items]) => (
              <nav key={title} aria-label={title}>
                <p className="text-[12px] font-medium tracking-[0.08em] text-foreground uppercase">{title}</p>
                <ul className="mt-5 grid gap-3">
                  {items.map(([label, href]) => <li key={label + href}><Link href={href} className={link}>{label}</Link></li>)}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-16 grid gap-10 md:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)] md:items-end">
          <form onSubmit={(e) => { e.preventDefault(); setNote(true); }} className="max-w-[380px]">
            <p className="text-[15px] font-medium">{o.loop.title}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{o.loop.body}</p>
            <div className="mt-4 flex h-12 items-center rounded-full border border-white/20 bg-white pr-1.5 pl-4 text-[#171717] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sage">
              <MailIcon className="size-4 shrink-0 text-[#737373]" strokeWidth={1.75} aria-hidden />
              <label htmlFor="loop-email" className="sr-only">{o.loop.label}</label>
              <input id="loop-email" type="email" autoComplete="email" placeholder={o.loop.placeholder} className="h-full min-w-0 flex-1 bg-transparent px-3 text-[14px] outline-none placeholder:text-[#737373]" />
              <button type="submit" aria-label={o.loop.submit} className="grid size-9 shrink-0 place-items-center rounded-full bg-[#171717] text-white outline-none transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mk-accent">
                <ArrowRightIcon className="size-4" strokeWidth={1.75} aria-hidden />
              </button>
            </div>
            <p role="status" className="mt-2 min-h-5 text-[12px] text-muted-foreground">{note ? o.loop.notYet : ""}</p>
          </form>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 md:justify-end">
            <LanguageSwitch />
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-white/10 pt-6 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>{o.copyright}</p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 font-medium tracking-[0.06em] uppercase">
            {([[o.links.imprint, "/imprint"], [o.links.privacy, "/privacy"], [o.links.terms, "/terms"]] as const).map(([s, href]) => <li key={s}><Link href={href} className="rounded-sm underline-offset-4 hover:text-foreground hover:underline">{s}</Link></li>)}
          </ul>
        </div>
      </div>
    </footer>
  );
}
