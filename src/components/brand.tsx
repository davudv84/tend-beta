import Link from "next/link";
import { cn } from "@/lib/utils";
import { Mark } from "./glyph";

export { Mark };

export function Wordmark({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 rounded-[3px] text-foreground", className)}>
      <Mark />
      <span className="text-ui font-semibold tracking-[-0.01em]">Tend</span>
    </Link>
  );
}
