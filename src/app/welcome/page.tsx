import { cookies } from "next/headers";
import { pageTitle } from "@/i18n/server";
import { PREFS_COOKIE, prefsFromCookie } from "@/ui/prefs";
import { UiPrefsProvider } from "@/ui/prefs-context";
import View from "./view";

export const generateMetadata = pageTitle("welcome");

/** The first-run setup guide. Its own focused frame: no sidebar, only the steps and a way out. */
export default async function Page() {
  const initial = prefsFromCookie((await cookies()).get(PREFS_COOKIE)?.value);
  return (
    <UiPrefsProvider initial={initial}>
      <View />
    </UiPrefsProvider>
  );
}
