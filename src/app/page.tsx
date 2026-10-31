import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";
import { config } from "@/server/config";
import { getDb } from "@/server/db";
import { isOperator } from "@/server/session";
import { Page } from "@/ui/page";
import { PublicFrame } from "@/ui/frame";
import { PREFS_COOKIE, prefsFromCookie } from "@/ui/prefs";
import { UiPrefsProvider } from "@/ui/prefs-context";

/** The front page: what Tend is, in one breath. An operator who is already signed in goes straight to their Home. */
export default async function FrontPage() {
  const h = await headers();
  if (await isOperator(await getDb(), new Request("http://localhost/", { headers: h }))) redirect("/home");
  const t = await getT();
  const w = t.front;
  const initial = prefsFromCookie((await cookies()).get(PREFS_COOKIE)?.value);
  return (
    <UiPrefsProvider initial={initial}>
      <PublicFrame>
        <Page className="pt-16 md:pt-28">
          <h1 className="text-headline max-w-[16ch] text-balance">{w.title}</h1>
          <p className="mt-6 max-w-[48ch] text-lead text-pretty text-muted-foreground">{w.body}</p>
          <ul className="mt-10 grid gap-3 text-body text-muted-foreground">
            {w.points.map((p) => (
              <li key={p} className="flex gap-3"><span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-faint" /><span className="text-pretty">{p}</span></li>
            ))}
          </ul>
          <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3">
            {config.accounts && <Button asChild className="h-12 rounded-full px-7 text-ui"><Link href="/account/sign-up">{w.create}</Link></Button>}
            <Link href={config.accounts ? "/account/sign-in" : "/operator"} className={config.accounts ? "rounded-md text-ui font-medium text-foreground underline-offset-4 hover:underline" : "inline-flex h-12 items-center rounded-full bg-primary px-7 text-ui text-primary-foreground"}>{w.signIn}</Link>
          </div>
        </Page>
      </PublicFrame>
    </UiPrefsProvider>
  );
}
