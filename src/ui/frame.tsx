"use client";

import Link from "next/link";
import { LanguageSwitch } from "@/components/language-switch";
import { useUiPrefs } from "@/ui/prefs-context";
import { useDocumentTheme } from "@/ui/theme";

/** The light-first surface for pages that have no sidebar (the front page): a wordmark, the language, and the content. */
export function PublicFrame({ children }: { children: React.ReactNode }) {
  const [prefs] = useUiPrefs();
  useDocumentTheme(prefs.theme);
  return (
    <div className="ui-next min-h-dvh" data-theme={prefs.theme}>
      <header className="mx-auto flex w-full max-w-[680px] items-center justify-between px-6 pt-8">
        <Link href="/" className="inline-flex items-center gap-2.5 rounded-md text-title font-semibold tracking-[-0.02em]">
          <span aria-hidden className="size-2.5 rounded-full bg-primary" />
          Tend
        </Link>
        <LanguageSwitch />
      </header>
      <main>{children}</main>
    </div>
  );
}
