import { notFound } from "next/navigation";
import { siteOnly } from "@/lib/site-only";
import { cookies } from "next/headers";
import { PREFS_COOKIE, prefsFromCookie } from "@/ui/prefs";
import { UiPrefsProvider } from "@/ui/prefs-context";
import { UiShell } from "@/ui/shell";

/**
 * The redesigned screens share one shell. Everything not yet redesigned stays in the original (app) layout.
 * The display preferences come from a cookie, so the first paint already has the right theme and amount of detail.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  if (siteOnly()) notFound(); // site-only showcase: the app is not part of it
  const initial = prefsFromCookie((await cookies()).get(PREFS_COOKIE)?.value);
  return (
    <UiPrefsProvider initial={initial}>
      <UiShell>{children}</UiShell>
    </UiPrefsProvider>
  );
}
