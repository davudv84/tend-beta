import type { Metadata } from "next";
import { ThreatModelPage } from "@/components/marketing/pages/threat-model";
import { getT } from "@/i18n/server";
import { config } from "@/server/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.front.pages.threatModel.meta };
}

export default function Page() {
  return <ThreatModelPage accounts={config.accounts} />;
}
