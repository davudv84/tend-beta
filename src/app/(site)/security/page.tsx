import type { Metadata } from "next";
import { SecurityPage } from "@/components/marketing/pages/security";
import { getT } from "@/i18n/server";
import { config } from "@/server/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.front.pages.security.meta };
}

export default function Page() {
  return <SecurityPage accounts={config.accounts} />;
}
