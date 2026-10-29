import { cookies } from "next/headers";
import { PREFS_COOKIE, prefsFromCookie } from "@/ui/prefs";
import { UiPrefsProvider } from "@/ui/prefs-context";
import { AccountFrame } from "./frame";

/** Sign-in, sign-up and the pages opened from mails: the TEND mark and one centred card, in the same theme as the dashboard. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const initial = prefsFromCookie((await cookies()).get(PREFS_COOKIE)?.value);
  return (
    <UiPrefsProvider initial={initial}>
      <AccountFrame>{children}</AccountFrame>
    </UiPrefsProvider>
  );
}
