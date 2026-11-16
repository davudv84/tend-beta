import type { Metadata } from "next";
import { CompareIndex } from "@/components/marketing/pages/compare";
import { getT } from "@/i18n/server";
import { config } from "@/server/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.front.pages.compare.meta };
}

/** TEND next to the products people compare it with: one row per comparison. */
export default function Page() {
  return <CompareIndex accounts={config.accounts} />;
}
