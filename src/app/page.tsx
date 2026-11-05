import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { newsreader } from "@/components/marketing/fonts";
import { Homepage } from "@/components/marketing/homepage";
import { homeImages } from "@/components/marketing/images";
import { config } from "@/server/config";
import { getDb } from "@/server/db";
import { isOperator } from "@/server/session";

/** The public homepage: what TEND is, shown with TEND's own screens. An operator who is already signed in goes straight to their Overview. */
export default async function FrontPage() {
  const h = await headers();
  if (await isOperator(await getDb(), new Request("http://localhost/", { headers: h }))) redirect("/home");
  return <Homepage accounts={config.accounts} images={homeImages()} fontClass={newsreader.variable} />;
}
