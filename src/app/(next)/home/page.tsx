import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { pageTitle } from "@/i18n/server";
import { getDb } from "@/server/db";
import { shouldOnboard } from "@/server/onboarding";
import { currentSession } from "@/server/session";
import { bindWorkspace, withRequestContext } from "@/server/db-context";
import View from "./view";

export const generateMetadata = pageTitle("home");

/** An account that has neither finished nor skipped the setup guide starts there. Decided on the server, so Home never flashes first. */
async function needsGuide() {
  try {
    const db = await getDb();
    const h = await headers();
    return await withRequestContext(async () => {
      const s = await currentSession(db, new Request("http://localhost/home", { headers: h }));
      if (!s) return false;
      bindWorkspace(s.workspace); // the database shows this page only the signed-in account's own workspace
      return shouldOnboard(db, s);
    });
  } catch {
    return false; // the database is unreachable: Home itself says so
  }
}

export default async function Page() {
  if (await needsGuide()) redirect("/welcome");
  return <View />;
}
