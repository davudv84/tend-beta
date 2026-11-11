"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/i18n/client";
import { BrandMark } from "@/ui/brand-mark";
import { useUiPrefs } from "@/ui/prefs-context";
import { useDocumentTheme } from "@/ui/theme";

/**
 * The page around every account form: the TEND mark on the left, the way to the other form on the right (create an account from
 * sign-in, sign in from everywhere else), the form by itself in the middle with no card around it, and Contact at the bottom.
 */
export function AccountFrame({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [prefs] = useUiPrefs();
  useDocumentTheme(prefs.theme);
  const onSignIn = usePathname() === "/account/sign-in";
  return (
    <div className="ui-next flex min-h-dvh flex-col bg-background text-foreground" data-theme={prefs.theme}>
      <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link href="/" aria-label="TEND" className="flex items-center gap-3 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
          <BrandMark className="size-6 text-primary" />
          <span className="text-[15px] font-semibold tracking-[0.16em]">TEND</span>
        </Link>
        <Link href={onSignIn ? "/account/sign-up" : "/account/sign-in"} className="inline-flex h-9 items-center rounded-full bg-foreground px-4 text-[14px] font-medium text-background outline-none transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          {onSignIn ? t.account.signIn.create : t.account.signIn.submit}
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center px-5 py-10">{children}</main>
      <footer className="pb-8 text-center text-small">
        <Link href="/contact" className="rounded-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-primary">{t.front.footer.links.contact}</Link>
      </footer>
    </div>
  );
}
