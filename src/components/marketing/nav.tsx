"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ActivityIcon, BookOpenIcon, BotIcon, ChevronDownIcon, ChevronRightIcon, CircleCheckIcon, LayoutGridIcon, MenuIcon, ShieldCheckIcon, ShieldIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { Container, PrimaryLink } from "./kit";
import { Logo } from "./logo";
import { PRODUCTS, type ProductSlug } from "./site-data";

const Preview = dynamic(() => import("./nav-preview"), { ssr: false });
const Drawer = dynamic(() => import("./nav-drawer"), { ssr: false });

const ICON: Record<ProductSlug | "overview", typeof ShieldIcon> = { overview: LayoutGridIcon, approvals: CircleCheckIcon, rules: ShieldIcon, activity: ActivityIcon, agents: BotIcon, checks: ShieldCheckIcon };
const RESOURCES = [["docs", "/docs"], ["howItWorks", "/how-it-works"], ["threatModel", "/threat-model"], ["compare", "/compare"], ["report", "/verification-report"], ["security", "/security"], ["changelog", "/changelog"], ["about", "/about"], ["contact", "/contact"]] as const;
type Menu = "product" | "resources";
export type PreviewKey = ProductSlug | "overview" | (typeof RESOURCES)[number][0];

/**
 * The site's header, as on sim.ai: a thin line about the beta, then a bar that stays at the top with the logo, Product and Resources
 * menus that open wide with a live preview of the page under the pointer, two plain links, sign in and create an account. On a phone
 * everything is in a drawer.
 */
export function Nav({ accounts }: { accounts: boolean }) {
  const t = useT();
  const f = t.front;
  const n = f.nav;
  const [menu, setMenu] = useState<Menu | null>(null);
  const [preview, setPreview] = useState<PreviewKey>("overview");
  const [drawer, setDrawer] = useState(false);
  const [drawerLoaded, setDrawerLoaded] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  // On a phone the bar steps out of the way while reading down the page and comes back the moment the reader scrolls up.
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 8) return;
      setTucked(y > last && y > 160);
      last = y;
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);
  const closing = useRef<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const signIn = accounts ? "/account/sign-in" : "/operator";
  const create = accounts ? "/account/sign-up" : "/operator";

  const openMenu = (m: Menu) => {
    if (closing.current) clearTimeout(closing.current);
    setMenu(m);
    setPreview(m === "product" ? "overview" : "docs");
  };
  const later = () => {
    if (closing.current) clearTimeout(closing.current);
    closing.current = window.setTimeout(() => setMenu(null), 140);
  };
  useEffect(() => {
    if (!menu) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    const click = (e: MouseEvent) => !bar.current?.contains(e.target as Node) && setMenu(null);
    addEventListener("keydown", key);
    addEventListener("mousedown", click);
    return () => { removeEventListener("keydown", key); removeEventListener("mousedown", click); };
  }, [menu]);

  const products: [PreviewKey, string, string, string][] = [
    ["overview", n.overview, n.overviewNote, "/"],
    ...PRODUCTS.map((p) => [p, f.product[p].name, f.product[p].note, `/product/${p}`] as [PreviewKey, string, string, string]),
  ];
  const resources: [PreviewKey, string, string, string][] = RESOURCES.map(([k, href]) => [k, n.res[k][0], n.res[k][1], href]);
  const trigger = (m: Menu, label: string) => (
    <button
      type="button"
      aria-expanded={menu === m}
      aria-controls={`menu-${m}`}
      onClick={() => (menu === m ? setMenu(null) : openMenu(m))}
      onPointerEnter={(e) => e.pointerType === "mouse" && openMenu(m)}
      className={cn("inline-flex h-8 items-center gap-1 rounded-full px-3 text-[14px] outline-none transition-colors hover:text-foreground", menu === m ? "bg-white/[0.07] text-foreground" : "text-foreground/80")}
    >
      {label}<ChevronDownIcon className={cn("size-3.5 transition-transform", menu === m && "rotate-180")} strokeWidth={2} aria-hidden />
    </button>
  );

  return (
    <>
      <div className="border-b border-white/[0.06] bg-[#141414]">
        <Container className="flex h-9 items-center justify-center gap-3 text-[12.5px] pointer-coarse:h-11">
          <span className="truncate text-foreground/85"><span className="sm:hidden">{f.top.short}</span><span className="hidden sm:inline">{f.top.text}</span></span>
          <Link href="/security" className="shrink-0 text-muted-foreground underline underline-offset-4 decoration-white/25 hover:text-foreground sm:no-underline sm:hover:underline"><span className="sm:hidden">{f.top.shortLink}</span><span className="hidden sm:inline">{f.top.link}</span></Link>
        </Container>
      </div>
      <header className={cn("sticky top-0 z-40 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none lg:translate-y-0", tucked && !drawer && "max-lg:-translate-y-full")}>
        <div ref={bar} onPointerLeave={(e) => e.pointerType === "mouse" && later()} onPointerEnter={() => closing.current && clearTimeout(closing.current)} className={cn("relative border-b bg-[#181818]/90 backdrop-blur-md transition-colors", menu ? "border-white/[0.08]" : "border-transparent")}>
          <Container className="flex h-16 items-center justify-between gap-6">
            <Logo />
            <nav aria-label={n.label} className="hidden items-center gap-1 lg:flex">
              {trigger("product", n.product)}
              {trigger("resources", n.resources)}
              <Link href="/security" onPointerEnter={() => setMenu(null)} className="inline-flex h-8 items-center rounded-full px-3 text-[14px] text-foreground/80 outline-none hover:text-foreground">{n.security}</Link>
              <Link href="/docs" onPointerEnter={() => setMenu(null)} className="inline-flex h-8 items-center rounded-full px-3 text-[14px] text-foreground/80 outline-none hover:text-foreground">{n.docs}</Link>
            </nav>
            <div className="hidden items-center gap-1.5 lg:flex">
              <Link href={signIn} className="inline-flex h-8 items-center rounded-full border border-white/[0.12] px-3.5 text-[13.5px] text-foreground/90 outline-none hover:bg-white/[0.06]">{f.signIn}</Link>
              <PrimaryLink href={create} className="h-8 px-3.5 text-[13.5px]">{f.create}</PrimaryLink>
            </div>
            <button ref={menuButton} type="button" aria-label={f.nav.menu} aria-haspopup="dialog" aria-expanded={drawer} onClick={() => { setDrawerLoaded(true); setDrawer(true); }} className="mk-press -mr-2 grid size-11 place-items-center rounded-full text-foreground outline-none lg:hidden">
              <MenuIcon className="size-5" strokeWidth={1.75} aria-hidden />
            </button>
            {drawerLoaded && <Drawer open={drawer} setOpen={setDrawer} products={products} resources={resources} signIn={signIn} create={create} returnTo={menuButton} />}
          </Container>

          {menu && (
            <div id={`menu-${menu}`} className="absolute inset-x-0 top-full hidden border-b border-white/[0.08] bg-[#181818] shadow-[0_40px_80px_-40px_rgb(0_0_0/0.9)] lg:block">
              <Container className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-10 py-8">
                <ul className="grid grid-cols-2 gap-x-8 gap-y-2">
                  {(menu === "product" ? products : resources).map(([key, label, note, href]) => {
                    const Icon = key in ICON ? ICON[key as keyof typeof ICON] : BookOpenIcon;
                    return (
                      <li key={key}>
                        <Link href={href} onClick={() => setMenu(null)} onPointerEnter={() => setPreview(key)} onFocus={() => setPreview(key)} className={cn("group grid grid-cols-[28px_minmax(0,1fr)] gap-x-2 rounded-lg p-2.5 outline-none transition-colors", preview === key ? "bg-white/[0.05]" : "hover:bg-white/[0.04]")}>
                          <span aria-hidden className="mt-0.5 grid size-6 place-items-center rounded-md border border-white/[0.1] bg-white/[0.04]"><Icon className="size-3.5 text-foreground/80" strokeWidth={1.75} /></span>
                          <span className="flex items-center gap-1 text-[14px] font-medium">{label}<ChevronRightIcon className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} aria-hidden /></span>
                          <span className="col-start-2 mt-0.5 text-[13px] leading-snug text-muted-foreground">{note}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <div aria-hidden inert className="pointer-events-none relative h-[280px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#141414] p-6">
                  <div className="mx-auto max-w-[456px]"><Preview k={preview} /></div>
                  <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#141414] to-transparent" />
                </div>
              </Container>
            </div>
          )}
        </div>
      </header>
    </>
  );
}
