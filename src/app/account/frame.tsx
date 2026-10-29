"use client";

import Link from "next/link";
import { BrandMark } from "@/ui/brand-mark";
import { useUiPrefs } from "@/ui/prefs-context";
import { useDocumentTheme } from "@/ui/theme";

export function AccountFrame({ children }: { children: React.ReactNode }) {
  const [prefs] = useUiPrefs();
  useDocumentTheme(prefs.theme);
  return (
    <div className="ui-next flex min-h-dvh flex-col items-center bg-background px-4 py-14 text-foreground sm:justify-center sm:py-20" data-theme={prefs.theme}>
      <Link href="/" aria-label="TEND" className="mb-8 flex items-center gap-3 outline-none focus-visible:outline-2 focus-visible:outline-primary">
        <BrandMark className="size-6 text-primary" />
        <span className="text-[15px] font-semibold tracking-[0.16em]">TEND</span>
      </Link>
      <main className="w-full max-w-[400px] rounded-2xl border border-border bg-background p-6 sm:p-8">{children}</main>
    </div>
  );
}
