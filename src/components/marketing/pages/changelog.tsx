"use client";

import { ArrowUpRightIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { PageHeader } from "../page-parts";
import { SITE } from "../site";

/** The changelog, from the commit history: one dated entry per day that changed something a user would notice. */
export function ChangelogPage() {
  const t = useT();
  const p = t.front.pages.changelog;
  return (
    <>
      <PageHeader eyebrow={p.eyebrow} title={p.title} lead={p.lead}>
        <a href={`${SITE.github}/commits/main`} target="_blank" rel="noreferrer" className="mt-6 inline-flex min-h-11 items-center gap-1.5 rounded-sm text-[14px] font-medium text-foreground/90 hover:text-foreground">
          {p.source}<ArrowUpRightIcon className="size-3.5" strokeWidth={2} aria-hidden />
        </a>
      </PageHeader>
      <section className="px-5 pt-8 pb-24 sm:px-8 md:pb-32">
        <ol className="mx-auto max-w-[1136px] border-t border-white/[0.08]">
          {p.entries.map(([date, items]) => (
            <li key={date} className="grid gap-3 border-b border-white/[0.08] py-8 md:grid-cols-[220px_minmax(0,1fr)] md:gap-10">
              <h2 className="text-[14px] text-muted-foreground"><time>{date}</time></h2>
              <ul className="grid max-w-[64ch] gap-2.5">
                {items.map((item) => <li key={item} className="flex gap-3 text-[15px] leading-relaxed text-foreground/90"><span aria-hidden className="mt-[10px] size-1.5 shrink-0 rounded-full bg-sage" />{item}</li>)}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
