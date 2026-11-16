import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { COMPETITORS, competitorBySlug } from "@/components/marketing/compare-data";
import { ComparePage } from "@/components/marketing/pages/compare";
import { getT } from "@/i18n/server";
import { config } from "@/server/config";

export function generateStaticParams() {
  return COMPETITORS.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const them = competitorBySlug((await params).slug);
  if (!them) return {};
  const t = await getT();
  return { title: t.front.pages.compare.metaOne(them.name), description: them.short };
}

/** TEND vs one product, every fact sourced and dated (components/marketing/compare-data.ts). */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const them = competitorBySlug((await params).slug);
  if (!them) notFound();
  return <ComparePage them={them} accounts={config.accounts} />;
}
