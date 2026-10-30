import { notFound } from "next/navigation";
import { connection } from "next/server";
import { pageTitle } from "@/i18n/server";
import { config } from "@/server/config";
import View from "./view";

export const generateMetadata = pageTitle("admin");

export default async function Page() {
  await connection(); // read TEND_ADMIN per request, not at build time
  if (config.adminDisabled) notFound();
  return <View />;
}
