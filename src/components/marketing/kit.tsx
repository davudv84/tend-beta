"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronRightIcon, RotateCcwIcon, SquareTerminalIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { TermLine } from "./site-data";

// The pieces every page of the site is built from, in the look of sim.ai's site: one charcoal page, hairlines between sections, large
// light sans headlines, white pills with a chevron, app screens in thin frames with a short caption and an "explore" link under them.

/** The page's width: about 1200px of content with a gutter that grows with the window. */
export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1200px] px-5 sm:px-8", className)}>{children}</div>;
}

/** A section with a hairline above it, the whole width of the window. */
export function Band({ children, className, id, label, line = true }: { children: React.ReactNode; className?: string; id?: string; label?: string; line?: boolean }) {
  return (
    <section id={id} aria-labelledby={label} className={cn("scroll-mt-28", line && "border-t border-white/[0.08]", className)}>
      {children}
    </section>
  );
}

/** The white pill with a chevron, and the quiet one beside it. */
export function PrimaryLink({ href, children, className, size = "md" }: { href: string; children: React.ReactNode; className?: string; size?: "md" | "lg" }) {
  return (
    <Link href={href} className={cn("mk-press group inline-flex items-center justify-center gap-1.5 rounded-full bg-white font-medium text-[#141414] outline-none hover:bg-[#e6e6e6]", size === "lg" ? "h-11 px-5 text-[15px]" : "h-9 px-4 text-[14px] pointer-coarse:h-11", className)}>
      {children}
      <ChevronRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} aria-hidden />
    </Link>
  );
}
export function QuietLink({ href, children, className, size = "md" }: { href: string; children: React.ReactNode; className?: string; size?: "md" | "lg" }) {
  return (
    <Link href={href} className={cn("mk-press inline-flex items-center justify-center rounded-full border border-white/[0.12] font-medium text-foreground outline-none hover:bg-white/[0.06]", size === "lg" ? "h-11 px-5 text-[15px]" : "h-9 px-4 text-[14px] pointer-coarse:h-11", className)}>
      {children}
    </Link>
  );
}
/** The small outlined link under a screen: "Explore the CLI >". */
export function ExploreLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("mk-press group inline-flex h-8 pointer-coarse:h-11 items-center gap-1 rounded-full border border-white/[0.12] pr-2.5 pl-3.5 text-[13px] text-foreground/90 outline-none hover:bg-white/[0.06] hover:text-foreground", className)}>
      {children}
      <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" strokeWidth={2} aria-hidden />
    </Link>
  );
}

/** The words under a screen: a short title, two lines and the link. */
export function Caption({ title, body, href, link, className, level = 3 }: { title: string; body: string; href?: string; link?: string; className?: string; level?: 2 | 3 }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className={cn("max-w-[42ch]", className)}>
      <H className="text-[15px] font-medium text-foreground">{title}</H>
      <p className="mt-1 text-[15px] leading-[1.45] text-muted-foreground">{body}</p>
      {href && link && <ExploreLink href={href} className="mt-4">{link}</ExploreLink>}
    </div>
  );
}

/**
 * An app screen on the page: the app's own dark tokens (`.mk .ui-next[data-theme="dark"]`), a thin frame and a header with an icon,
 * a title and anything on the right. Everything inside uses the app's colours and components.
 */
export function AppPanel({ title, icon: Icon, right, children, className, bodyClassName, label }: {
  title?: string; icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>; right?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string; label?: string;
}) {
  return (
    <div role={label ? "group" : undefined} aria-label={label} className={cn("ui-next dark relative overflow-hidden rounded-xl border border-white/[0.09] bg-background text-foreground shadow-[0_30px_80px_-40px_rgb(0_0_0/0.8)]", className)} data-theme="dark">
      {title && (
        <div className="flex h-11 items-center justify-between gap-3 border-b border-border px-4">
          <p className="flex min-w-0 items-center gap-2 text-[13px] font-medium">{Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />}<span className="truncate">{title}</span></p>
          {right && <div className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">{right}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

/**
 * One of the app's screens shown as a picture of itself: drawn at the size `inner` gives it (a width, and a zoom to make it smaller)
 * and cut by the card it sits in, as a window is by a frame. It can't be clicked or tabbed into, so nothing half-hidden takes the
 * focus; the same screen is live on its product page.
 */
export function Screen({ children, className, inner }: { children: React.ReactNode; className?: string; inner: string }) {
  return (
    <div aria-hidden inert className={cn("pointer-events-none overflow-hidden", className)}>
      <div className={inner}>{children}</div>
    </div>
  );
}

/** The small "Example" tag in a screen's header, so invented data never reads as real. */
export function ExampleTag() {
  const t = useT();
  return <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{t.front.kit.example}</span>;
}

/** True once the element has been on screen, so an animation starts when someone can see it. */
export function useSeen<T extends Element>(margin = "0px 0px -15% 0px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      setSeen(true);
      io.disconnect();
    }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, seen] as const;
}

export const prefersReducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A terminal that types TEND's real commands once it scrolls into view, prints what they printed, and stops. "Run again" types them
 * again, only when asked. With reduced motion everything is shown at once.
 */
export function Terminal({ cwd, lines, className, minHeight = 260, compact }: { cwd: string; lines: TermLine[]; className?: string; minHeight?: number; compact?: boolean }) {
  const t = useT();
  const k = t.front.kit.terminal;
  const [ref, seen] = useSeen<HTMLDivElement>();
  const [run, setRun] = useState(0);
  // How far the typing has got: the line, and how many characters of its command.
  const [pos, setPos] = useState<{ line: number; chars: number; printed: boolean }>({ line: 0, chars: 0, printed: false });
  const done = pos.line >= lines.length;

  useEffect(() => {
    if (!seen) return;
    let line = 0, chars = 0;
    let timer: number;
    if (prefersReducedMotion()) {
      timer = window.setTimeout(() => setPos({ line: lines.length, chars: 0, printed: true }), 0);
      return () => clearTimeout(timer);
    }
    const step = () => {
      if (line >= lines.length) return;
      const cmd = lines[line].cmd;
      if (chars < cmd.length) {
        chars = Math.min(cmd.length, chars + (cmd.length > 60 ? 3 : 1));
        setPos({ line, chars, printed: false });
        timer = window.setTimeout(step, 28);
      } else {
        setPos({ line, chars, printed: true });
        line += 1;
        chars = 0;
        timer = window.setTimeout(() => { setPos({ line, chars: 0, printed: false }); step(); }, 650);
      }
    };
    timer = window.setTimeout(step, 400);
    return () => clearTimeout(timer);
  }, [seen, run, lines]);

  return (
    <div ref={ref} className={cn("relative overflow-hidden rounded-xl border border-white/[0.09] bg-[#141414] shadow-[0_30px_80px_-40px_rgb(0_0_0/0.8)]", className)}>
      <div className="grid h-10 grid-cols-[1fr_auto_1fr] items-center border-b border-white/[0.07] px-4">
        <span aria-hidden className="flex gap-1.5"><span className="size-2.5 rounded-full bg-white/[0.16]" /><span className="size-2.5 rounded-full bg-white/[0.16]" /><span className="size-2.5 rounded-full bg-white/[0.16]" /></span>
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><SquareTerminalIcon className="size-3.5" strokeWidth={1.75} aria-hidden />{k.title}</span>
        <span className="justify-self-end">
          {done && seen && (
            <button type="button" onClick={() => { setPos({ line: 0, chars: 0, printed: false }); setRun((r) => r + 1); }} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground outline-none hover:bg-white/[0.06] hover:text-foreground">
              <RotateCcwIcon className="size-3" strokeWidth={2} aria-hidden />{k.replay}
            </button>
          )}
        </span>
      </div>
      {/* The full text is always there for a screen reader; the typing is only what is drawn. */}
      <pre className="sr-only">{lines.map((l) => `$ ${l.cmd}\n${(l.out ?? []).join("\n")}`).join("\n")}</pre>
      <div aria-hidden className={cn("overflow-x-auto font-mono", compact ? "px-3 py-3 text-[11px] leading-[1.6]" : "px-4 py-4 text-[12.5px] leading-[1.7] sm:px-5")} style={{ minHeight }}>
        <p className="text-muted-foreground">{cwd}</p>
        {lines.map((l, i) => {
          if (i > pos.line) return null;
          const typing = i === pos.line;
          const shown = typing ? l.cmd.slice(0, pos.chars) : l.cmd;
          const printed = !typing || pos.printed;
          return (
            <div key={i} className="mt-2">
              <p className="whitespace-pre-wrap break-words text-[#ededed]"><span className="mr-2 text-muted-foreground">$</span>{shown}{typing && !pos.printed && <span className="mk-caret ml-px inline-block h-[1.05em] w-[0.55em] translate-y-[2px] bg-[#ededed]" />}</p>
              {printed && l.out?.map((o, j) => <p key={j} className="whitespace-pre-wrap break-words text-[#a3a3a3]">{o}</p>)}
            </div>
          );
        })}
        {done && <p className="mt-2 text-[#ededed]"><span className="mr-2 text-muted-foreground">$</span><span className="mk-caret inline-block h-[1.05em] w-[0.55em] translate-y-[2px] bg-[#ededed]" /></p>}
      </div>
    </div>
  );
}

/** A big centered headline in two lines, with a small crumb above it ("TEND / Approvals"). */
export function DisplayTitle({ crumb, lines, as: As = "h1", className, id }: { crumb?: string; lines: readonly string[]; as?: "h1" | "h2"; className?: string; id?: string }) {
  return (
    <div className={cn("text-center", className)}>
      {crumb && <p className="text-[14px] text-muted-foreground">{crumb}</p>}
      <As id={id} className={cn("mk-display mx-auto text-[clamp(2.6rem,7vw,5.25rem)]", crumb && "mt-5")}>
        {lines.map((l, i) => <span key={i} className="block">{l}</span>)}
      </As>
    </div>
  );
}
