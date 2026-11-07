import type { Metadata } from "next";
import { HowItWorksPage } from "@/components/marketing/pages/how-it-works";
import { getT } from "@/i18n/server";
import { config } from "@/server/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.front.pages.howItWorks.meta };
}

export default function Page() {
  return <HowItWorksPage accounts={config.accounts} />;
}
