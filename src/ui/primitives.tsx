import Link from "next/link";
import { cn } from "@/lib/utils";

/** A bordered white card, as in the design: 12px radius, hairline border, no shadow. */
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("overflow-hidden rounded-xl border border-border bg-background", className)}>{children}</section>;
}

/** The title row of a card: a title, an optional line under it, and one quiet thing at the right. */
export function CardHeader({ title, sub, right, id }: { title: string; sub?: string; right?: React.ReactNode; id?: string }) {
  return (
    <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
      <div className="min-w-0">
        <h2 id={id} className="text-[17px] font-medium">{title}</h2>
        {sub && <p className="mt-1 text-[14px] text-pretty text-muted-foreground">{sub}</p>}
      </div>
      {right && <div className="shrink-0 pt-0.5 text-[13px] text-muted-foreground">{right}</div>}
    </header>
  );
}

export type Tone = "good" | "attention" | "danger" | "neutral";
// Each tone has a tint for the light theme and one made for the dark surfaces, so a status reads as quietly in both.
const TONE: Record<Tone, string> = {
  good: "bg-[#eef6f2] text-[#176b50] dark:bg-[rgb(141_187_165/0.14)] dark:text-[#a6cbb8]",
  attention: "bg-[#fff4e5] text-[#92400e] dark:bg-[rgb(217_165_91/0.14)] dark:text-[#e4ba7a]",
  danger: "bg-[#fef1f0] text-[#b42318] dark:bg-[rgb(217_128_106/0.15)] dark:text-[#eba491]",
  neutral: "bg-[#f5f5f5] text-[#404040] dark:bg-[rgb(237_232_222/0.07)] dark:text-[#d2cbbe]",
};
const MARK: Record<Tone, string> = { good: "rounded-full bg-current", attention: "rotate-45 bg-current", danger: "bg-current", neutral: "rounded-full border border-current" };

/** A status is always a word; the small mark only repeats it (a dot, a diamond, a square, a ring). */
export function Badge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium whitespace-nowrap", TONE[tone], className)}>
      <span aria-hidden className={cn("size-1.5", MARK[tone])} />
      {children}
    </span>
  );
}

const BTN = "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-[14px] font-medium whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50";
export const buttonClass = (kind: "primary" | "secondary" | "danger" = "primary") =>
  cn(BTN, kind === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90", kind === "secondary" && "border border-border bg-background text-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.05]", kind === "danger" && "bg-[#b42318] text-white hover:bg-[#8f1c13]");

export function LinkButton({ href, children, kind = "primary", className }: { href: string; children: React.ReactNode; kind?: "primary" | "secondary"; className?: string }) {
  return <Link href={href} className={cn(buttonClass(kind), className)}>{children}</Link>;
}

/** A quiet text link in the accent colour, as the design uses for "Review", "View all" and "Details". */
export function TextLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return <Link href={href} className={cn(className, "rounded-sm text-[14px] font-medium text-primary underline-offset-[3px] hover:underline")}>{children} →</Link>;
}

/** One segment per check: green verified, red at risk, grey not verified. The words next to it say the same. */
export function SegmentBar({ verified, atRisk, notVerified }: { verified: number; atRisk: number; notVerified: number }) {
  const seg = (n: number, cls: string) => Array.from({ length: n }, (_, i) => <span key={cls + i} className={cn("h-1.5 flex-1 rounded-full", cls)} />);
  return <div aria-hidden className="flex gap-1">{seg(verified, "bg-primary")}{seg(atRisk, "bg-[#b42318]")}{seg(notVerified, "bg-[#e5e5e5]")}</div>;
}
