import Link from "next/link";
import { BrandMark } from "@/ui/brand-mark";
import { cn } from "@/lib/utils";

/** The app's mark and wordmark (as in ui/shell.tsx), on the dark page: the mark in the green that reads on black. */
export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} aria-label="TEND" className={cn("inline-flex items-center gap-3 rounded-md outline-none", className)}>
      <BrandMark className="size-6 shrink-0 text-sage" />
      <span className="text-[15px] font-semibold tracking-[0.16em] text-foreground">TEND</span>
    </Link>
  );
}

/** The mark on a white tile, in the app's own green. Decorative: the name is always written next to it. */
export function LogoTile({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-xl bg-white text-mk-accent", className)}>
      <BrandMark className={cn("size-[55%]", markClassName)} />
    </span>
  );
}
