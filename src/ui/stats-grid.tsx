"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export interface Stat {
  label: string;
  value: number;
  note: string;
  /** Where the number leads, when it leads somewhere. */
  href?: string;
  className?: string;
}

/**
 * Overview's four numbers: two by two, four in a row on a wide screen. Shared by the app's Overview and the homepage's demo, so both
 * look the same. `roomy` raises the small words to 14px, for the demo on a phone.
 */
export function StatsGrid({ stats, roomy, className }: { stats: Stat[]; roomy?: boolean; className?: string }) {
  const small = roomy ? "text-[14px]" : "text-[13px]";
  return (
    <dl className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4", className)}>
      {stats.map(({ label, value, note, href, className: cell }) => {
        const body = <><dt className={cn(small, "text-muted-foreground")}>{label}</dt><dd className="mt-2 text-[28px] leading-none font-medium tabular-nums">{value}</dd><dd className={cn("mt-2 text-muted-foreground", small)}>{note}</dd></>;
        return href
          ? <Link key={label} href={href} className={cn("bg-background px-5 py-4 outline-none transition-colors hover:bg-black/[0.025] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary dark:hover:bg-white/[0.04]", cell)}><div>{body}</div></Link>
          : <div key={label} className={cn("bg-background px-5 py-4", cell)}>{body}</div>;
      })}
    </dl>
  );
}
