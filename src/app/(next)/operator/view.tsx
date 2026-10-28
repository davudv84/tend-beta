"use client";

import Link from "next/link";
import { SignIn } from "@/components/sign-in";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { useStore } from "@/lib/store";
import { Page, PageSkeleton } from "@/ui/page";

export default function View() {
  const t = useT();
  const ready = useStore((s) => s.ready);
  const status = useStore((s) => s.status);
  const viewer = useStore((s) => s.viewer);
  const signOut = useStore((s) => s.signOut);
  if (viewer?.role === "operator")
    return (
      <Page>
        <h1 className="text-section text-balance">{t.signIn.signedIn}</h1>
        <p className="mt-4 max-w-[52ch] text-lead text-pretty text-muted-foreground">{t.signIn.signedInBody}</p>
        <div className="mt-10 flex flex-wrap gap-2.5">
          <Button asChild className="h-12 rounded-full px-7 text-ui"><Link href="/home">{t.signIn.goHome}</Link></Button>
          <Button variant="ghost" className="h-12 rounded-full px-5 text-ui" onClick={() => void signOut()}>{t.shell.signOut}</Button>
        </div>
      </Page>
    );
  if (!ready && status !== "signin") return <PageSkeleton label={t.home.loading} />;
  return (
    <Page>
      <h1 className="text-section text-balance">{t.signIn.title}</h1>
      <p className="mt-4 max-w-[46ch] text-lead text-pretty text-muted-foreground">{viewer?.public ? t.signIn.bodyPublic : t.signIn.bodyPrivate} {t.signIn.enterToken}</p>
      <div className="mt-10 max-w-sm"><SignIn compact /></div>
    </Page>
  );
}
