import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The column every screen sits in: one width and one left edge. Text and lists keep a readable measure inside it; a screen that
 * needs the whole width (tables, code) says so with `wide`, and a screen that lays itself out (the first-run page) uses `bare`.
 */
export function Page({ children, className, wide, bare, full }: { children: React.ReactNode; className?: string; wide?: boolean; bare?: boolean; full?: boolean }) {
  return (
    <div className={cn("mx-auto w-full max-w-[1180px] px-6 pt-10 pb-24 md:px-12 md:pt-14", className)}>
      {bare || full ? children : <div className={wide ? "max-w-[880px]" : "max-w-[680px]"}>{children}</div>}
    </div>
  );
}

/** Every list starts the same way: a title, and where it fits, one quiet action beside it. */
export function SectionHeader({ id, title, action }: { id: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 id={id} className="text-h2">{title}</h2>
      {action}
    </div>
  );
}

/** What is shown while the first state loads: where the headline and first block will be. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <Page>
      <div aria-busy="true" aria-label={label} className="grid gap-4">
        <div className="h-10 w-2/3 rounded-xl bg-sunken" />
        <div className="h-5 w-1/2 rounded-lg bg-sunken" />
        <div className="mt-10 h-48 rounded-3xl bg-sunken" />
      </div>
    </Page>
  );
}

/** The quiet way back, the same on every inner screen. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="-ml-1 inline-flex items-center gap-1 rounded-md py-1 pr-2 text-small text-muted-foreground transition-colors hover:text-foreground">
      <ChevronLeftIcon className="size-4" strokeWidth={1.75} aria-hidden />
      {label}
    </Link>
  );
}
