import type { Metadata } from "next";
import { ChangelogPage } from "@/components/marketing/pages/changelog";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.front.pages.changelog.meta };
}

export default function Page() {
  return <ChangelogPage />;
}
