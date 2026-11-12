"use client";

import Link from "next/link";
import { ChevronRightIcon, XIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import { LanguageSwitch } from "@/components/language-switch";
import { useT } from "@/i18n/client";
import { Logo } from "./logo";

// Loaded on the first tap of the menu button (nav.tsx), so the dialog's code isn't part of the first load. Focus goes back to the button on close.
/**
 * The phone's menu, laid out as sim.ai's: the logo and close; sign in and how it works side by side in one pill, the main button under
 * them; then plain lists, grouped, with the language at the foot. It slides in from the top and keeps clear of the home indicator.
 */
export default function Drawer({ open, setOpen, products, resources, signIn, create, returnTo }: { open: boolean; setOpen: (v: boolean) => void; products: [string, string, string, string][]; resources: [string, string, string, string][]; signIn: string; create: string; returnTo: React.RefObject<HTMLButtonElement | null> }) {
  const t = useT();
  const f = t.front;
  const close = () => setOpen(false);
  const group = (title: string, items: [string, string, string, string][]) => (
    <div>
      <p className="text-[12.5px] text-muted-foreground">{title}</p>
      <ul className="mt-1.5 grid">{items.map(([key, label, , href]) => <li key={key}><Link href={href} onClick={close} className="mk-press -mx-2 flex min-h-11 items-center rounded-lg px-2 text-[16px] text-foreground/90 active:bg-white/[0.06]">{label}</Link></li>)}</ul>
    </div>
  );
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        {/* The drawer is rendered at the end of the document, so it carries the site's scope itself. */}
        <Dialog.Content aria-describedby={undefined} onCloseAutoFocus={(e) => { e.preventDefault(); returnTo.current?.focus(); }} className="mk fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-[#181818] px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] outline-none duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-3 motion-reduce:animate-none">
          <Dialog.Title className="sr-only">{f.nav.menu}</Dialog.Title>
          <div className="flex h-12 items-center justify-between">
            <Logo />
            <Dialog.Close aria-label={f.nav.closeMenu} className="mk-press grid size-11 place-items-center rounded-full border border-white/[0.12] text-muted-foreground outline-none hover:text-foreground">
              <XIcon className="size-4" strokeWidth={1.75} aria-hidden />
            </Dialog.Close>
          </div>
          <div className="mt-5 grid gap-2.5">
            <div className="grid h-11 grid-cols-2 rounded-full border border-white/[0.12] p-1 text-[14px]">
              <Link href={signIn} onClick={close} className="mk-press grid place-items-center rounded-full text-foreground/90 active:bg-white/[0.08]">{f.signIn}</Link>
              <Link href="/how-it-works" onClick={close} className="mk-press grid place-items-center rounded-full text-foreground/90 active:bg-white/[0.08]">{f.hero.howItWorks}</Link>
            </div>
            <Link href={create} onClick={close} className="mk-press relative flex h-12 items-center justify-center rounded-full bg-white text-[15px] font-medium text-[#141414]">{f.create}<ChevronRightIcon className="absolute right-4 size-4" strokeWidth={2} aria-hidden /></Link>
          </div>
          <nav aria-label={f.nav.label} className="mt-9 grid gap-7">
            {group(f.nav.product, products)}
            {group(f.nav.resources, resources)}
          </nav>
          <div className="mt-auto pt-10"><div className="flex justify-between border-t border-white/[0.08] pt-4"><LanguageSwitch /></div></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
