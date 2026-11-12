"use client";

import Link from "next/link";
import { MailIcon } from "lucide-react";
import { LanguageSwitch } from "@/components/language-switch";
import { useT } from "@/i18n/client";
import { Logo } from "./logo";
import { PRODUCTS } from "./site-data";
import { SITE } from "./site";
import type { HomeImages } from "./types";

type Item = [label: string, href: string];

/**
 * The footer: the logo and the way to get in touch, three columns of links (every one leads to a page), the language and
 * the legal links. No newsletter until there is one that really stores addresses (with double opt-in).
 */
export function Footer({ accounts }: { accounts: boolean; images?: HomeImages }) {
  const t = useT();
  const f = t.front;
  const o = f.footer;
  const columns: [string, Item[]][] = [
    [o.columns.product, [[f.nav.overview, "/"], ...PRODUCTS.map((p) => [f.product[p].name, `/product/${p}`] as Item), [f.signIn, accounts ? "/account/sign-in" : "/operator"], ...(accounts ? [[f.create, "/account/sign-up"] as Item] : [])]],
    [o.columns.resources, [[o.links.docs, "/docs"], [o.links.howItWorks, "/how-it-works"], [o.links.report, "/verification-report"], [o.links.limitations, "/security"]]],
    [o.columns.company, [[o.links.about, "/about"], [o.links.contact, "/contact"], [o.links.imprint, "/imprint"]]],
  ];
  const link = "rounded-sm text-[14px] text-foreground/75 transition-colors hover:text-foreground";
  return (
    <footer className="border-t border-white/[0.08]">
      <div className="mx-auto max-w-[1200px] px-5 pt-14 pb-10 sm:px-8 md:pt-20">
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
                <p className="text-[13px] text-muted-foreground">{title}</p>
                <ul className="mt-4 grid gap-2.5">
                  {items.map(([label, href]) => <li key={label + href}><Link href={href} className={link}>{label}</Link></li>)}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-16 flex">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <LanguageSwitch />
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-white/[0.08] pt-6 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>{o.copyright}</p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {([[o.links.imprint, "/imprint"], [o.links.privacy, "/privacy"], [o.links.terms, "/terms"]] as const).map(([s, href]) => <li key={s}><Link href={href} className="rounded-sm underline-offset-4 hover:text-foreground hover:underline">{s}</Link></li>)}
          </ul>
        </div>
      </div>
    </footer>
  );
}
