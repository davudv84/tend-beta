import type { Metadata } from "next";
import { TermsPage } from "@/components/marketing/pages/legal";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.front.pages.terms.meta };
}

export default function Page() {
  return <TermsPage />;
}
