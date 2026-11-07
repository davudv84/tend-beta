import type { Metadata } from "next";
import { ImprintPage } from "@/components/marketing/pages/legal";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.front.pages.imprint.meta };
}

export default function Page() {
  return <ImprintPage />;
}
