import type { Metadata } from "next";
import { AboutPage } from "@/components/marketing/pages/about";
import { getT } from "@/i18n/server";
import { config } from "@/server/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.front.pages.about.meta };
}

export default function Page() {
  return <AboutPage accounts={config.accounts} />;
}
