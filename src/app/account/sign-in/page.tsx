import { connection } from "next/server";
import { pageTitle } from "@/i18n/server";
import { config } from "@/server/config";
import { SignIn } from "../forms";

export const generateMetadata = pageTitle("account");

export default async function Page() {
  await connection(); // read TEND_ADMIN per request, not at build time
  return <SignIn admin={!config.adminDisabled} />;
}
