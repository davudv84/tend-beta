import type { Metadata } from "next";
import { PrivacyPage } from "@/components/marketing/pages/legal";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.front.pages.privacy.meta };
}

export default function Page() {
  return <PrivacyPage />;
}
