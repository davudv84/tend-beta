import type { Metadata } from "next";
import { ContactPage } from "@/components/marketing/pages/contact";
import { getT } from "@/i18n/server";
import { config } from "@/server/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.front.pages.contact.meta };
}

export default function Page() {
  return <ContactPage accounts={config.accounts} />;
}
