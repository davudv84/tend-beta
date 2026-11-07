"use client";

import Link from "next/link";
import { useState } from "react";
import { MenuIcon, XIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import { LanguageSwitch } from "@/components/language-switch";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { Logo } from "./logo";
import { pill } from "./pill";

const SECTIONS = ["product", "features", "integrations", "security"] as const;

/**
 * The site's header: the logo, four links to the homepage's sections (written as `/#id`, so they work from every page of the site), sign in
 * and create an account. On a phone the links and buttons are in a drawer.
 */
export function Nav({ accounts }: { accounts: boolean }) {
  const t = useT();
  const f = t.front;
  const [open, setOpen] = useState(false);
  const signIn = accounts ? "/account/sign-in" : "/operator";
  const link = "rounded-md text-[14px] text-foreground/85 transition-colors hover:text-foreground";
  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <div className="mx-auto flex h-20 max-w-[1240px] items-center justify-between px-6 md:px-8">
        <Logo />
        <nav aria-label={f.nav.label} className="hidden items-center gap-8 lg:flex">
          {SECTIONS.map((id) => <Link key={id} href={`/#${id}`} className={link}>{f.nav[id]}</Link>)}
        </nav>
        <div className="hidden items-center gap-2.5 lg:flex">
          <Button asChild className={pill("light")}><Link href={signIn}>{f.signIn}</Link></Button>
          {accounts && <Button asChild variant="secondary" className={pill("dark")}><Link href="/account/sign-up">{f.create}</Link></Button>}
        </div>

        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger aria-label={f.nav.menu} className="grid size-11 place-items-center rounded-full text-foreground outline-none lg:hidden">
            <MenuIcon className="size-5" strokeWidth={1.75} aria-hidden />
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
            {/* The drawer is rendered at the end of the document, so it carries the marketing scope itself. */}
            <Dialog.Content aria-describedby={undefined} className="mk fixed inset-y-0 right-0 z-50 flex w-[320px] max-w-[88vw] flex-col border-l border-border bg-mk-surface p-6 outline-none">
              <Dialog.Title className="sr-only">{f.nav.menu}</Dialog.Title>
              <div className="flex items-center justify-between">
                <Logo />
                <Dialog.Close aria-label={f.nav.closeMenu} className="grid size-10 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground">
                  <XIcon className="size-5" strokeWidth={1.75} aria-hidden />
                </Dialog.Close>
              </div>
              <nav aria-label={f.nav.label} className="mt-10 grid gap-1">
                {SECTIONS.map((id) => (
                  <Link key={id} href={`/#${id}`} onClick={() => setOpen(false)} className="rounded-lg px-2 py-3 text-[17px] text-foreground transition-colors hover:bg-white/5">{f.nav[id]}</Link>
                ))}
              </nav>
              <div className="mt-auto grid gap-2.5">
                {accounts && <Button asChild className={pill("light", "lg")}><Link href="/account/sign-up">{f.create}</Link></Button>}
                <Button asChild variant="secondary" className={pill("dark", "lg")}><Link href={signIn}>{f.signIn}</Link></Button>
                <div className="mt-4 flex justify-between border-t border-border pt-4">
                  <LanguageSwitch />
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </header>
  );
}
