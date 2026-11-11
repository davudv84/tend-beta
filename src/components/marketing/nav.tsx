"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ActivityIcon, BookOpenIcon, BotIcon, ChevronDownIcon, ChevronRightIcon, CircleCheckIcon, LayoutGridIcon, MenuIcon, ShieldCheckIcon, ShieldIcon, XIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import { LanguageSwitch } from "@/components/language-switch";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { StatsGrid } from "@/ui/stats-grid";
import { AppPanel, Container, PrimaryLink } from "./kit";
import { Logo } from "./logo";
import { ActivityMini } from "./panels/activity";
import { AgentsMini } from "./panels/agents";
import { ApprovalsMini } from "./panels/approvals";
import { ChecksMini } from "./panels/checks";
import { RulesMini } from "./panels/rules";
import { PRODUCTS, type ProductSlug } from "./site-data";

const ICON: Record<ProductSlug | "overview", typeof ShieldIcon> = { overview: LayoutGridIcon, approvals: CircleCheckIcon, rules: ShieldIcon, activity: ActivityIcon, agents: BotIcon, checks: ShieldCheckIcon };
const RESOURCES = [["docs", "/docs"], ["howItWorks", "/how-it-works"], ["report", "/verification-report"], ["security", "/security"], ["about", "/about"], ["contact", "/contact"]] as const;
type Menu = "product" | "resources";
type PreviewKey = ProductSlug | "overview" | (typeof RESOURCES)[number][0];

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
        <Container className="flex h-9 items-center justify-center gap-3 text-[12.5px]">
          <span className="truncate text-foreground/85">{f.top.text}</span>
          <Link href="/security" className="shrink-0 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{f.top.link}</Link>
        </Container>
      </div>
      <header className="sticky top-0 z-40">
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
            <Drawer open={drawer} setOpen={setDrawer} products={products} resources={resources} signIn={signIn} create={create} />
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
                  <div className="mx-auto max-w-[380px]"><Preview k={preview} /></div>
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

/** The live screen shown beside the menu for the item under the pointer. */
function Preview({ k }: { k: PreviewKey }) {
  const t = useT();
  const s = t.home.dash.stats;
  if (k === "approvals") return <ApprovalsMini />;
  if (k === "rules") return <RulesMini />;
  if (k === "activity") return <ActivityMini />;
  if (k === "agents") return <AgentsMini />;
  if (k === "checks") return <ChecksMini />;
  if (k === "overview") return <AppPanel title={t.ui.nav.home} icon={LayoutGridIcon} bodyClassName="p-3"><StatsGrid stats={[{ label: s.running, value: 3, note: s.of(4) }, { label: s.waiting, value: 2, note: s.now }, { label: s.auto, value: 14, note: s.day }, { label: s.blocked, value: 2, note: s.day }]} className="lg:grid-cols-2" /></AppPanel>;
  const c = t.front.kit.connect;
  return (
    <AppPanel title={t.front.nav.res[k][0]} icon={BookOpenIcon} bodyClassName="grid gap-2 p-4">
      <p className="text-[13px] text-muted-foreground">{t.front.nav.res[k][1]}</p>
      <ol className="mt-1 grid gap-1.5">{c.steps.map((s2, i) => <li key={s2} className="flex items-center gap-2.5 text-[13px]"><span className="grid size-5 place-items-center rounded-full border border-border text-[11px] tabular-nums">{i + 1}</span>{s2}</li>)}</ol>
    </AppPanel>
  );
}

/** The phone's menu: everything from the header, grouped, with the two buttons and the language at the bottom. */
function Drawer({ open, setOpen, products, resources, signIn, create }: { open: boolean; setOpen: (v: boolean) => void; products: [string, string, string, string][]; resources: [string, string, string, string][]; signIn: string; create: string }) {
  const t = useT();
  const f = t.front;
  const close = () => setOpen(false);
  const group = (title: string, items: [string, string, string, string][]) => (
    <div>
      <p className="px-2 text-[12px] text-muted-foreground">{title}</p>
      <ul className="mt-2 grid">{items.map(([key, label, , href]) => <li key={key}><Link href={href} onClick={close} className="flex items-center justify-between rounded-lg px-2 py-2.5 text-[16px] hover:bg-white/5">{label}<ChevronRightIcon className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden /></Link></li>)}</ul>
    </div>
  );
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger aria-label={f.nav.menu} className="-mr-2 grid size-11 place-items-center rounded-full text-foreground outline-none lg:hidden">
        <MenuIcon className="size-5" strokeWidth={1.75} aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        {/* The drawer is rendered at the end of the document, so it carries the site's scope itself. */}
        <Dialog.Content aria-describedby={undefined} className="mk fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[#181818] px-5 pt-4 pb-6 outline-none">
          <Dialog.Title className="sr-only">{f.nav.menu}</Dialog.Title>
          <div className="flex h-12 items-center justify-between">
            <Logo />
            <Dialog.Close aria-label={f.nav.closeMenu} className="-mr-2 grid size-11 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground">
              <XIcon className="size-5" strokeWidth={1.75} aria-hidden />
            </Dialog.Close>
          </div>
          <nav aria-label={f.nav.label} className="mt-6 grid gap-8">
            {group(f.nav.product, products)}
            {group(f.nav.resources, resources)}
          </nav>
          <div className="mt-auto grid gap-2.5 pt-10">
            <Link href={create} onClick={close} className="flex h-12 items-center justify-center gap-1 rounded-full bg-white text-[15px] font-medium text-[#141414]">{f.create}<ChevronRightIcon className="size-4" strokeWidth={2} aria-hidden /></Link>
            <Link href={signIn} onClick={close} className="flex h-12 items-center justify-center rounded-full border border-white/[0.14] text-[15px] font-medium">{f.signIn}</Link>
            <div className="mt-4 flex justify-between border-t border-white/[0.08] pt-4"><LanguageSwitch /></div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
