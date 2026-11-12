import type { Metadata } from "next";
import { ComparePage } from "@/components/marketing/pages/compare";
import { getT } from "@/i18n/server";
import { config } from "@/server/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.front.pages.compare.meta };
}

export default function Page() {
  return <ComparePage accounts={config.accounts} />;
}
