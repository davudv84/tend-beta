import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { pageTitle } from "@/i18n/server";
import { getDb } from "@/server/db";
import { shouldOnboard } from "@/server/onboarding";
import { currentSession } from "@/server/session";
import View from "./view";

export const generateMetadata = pageTitle("home");

/** An account that has neither finished nor skipped the setup guide starts there. Decided on the server, so Home never flashes first. */
async function needsGuide() {
  try {
    const db = await getDb();
    const s = await currentSession(db, new Request("http://localhost/home", { headers: await headers() }));
    return !!s && (await shouldOnboard(db, s));
  } catch {
    return false; // the database is unreachable: Home itself says so
  }
}

export default async function Page() {
  if (await needsGuide()) redirect("/welcome");
  return <View />;
}
