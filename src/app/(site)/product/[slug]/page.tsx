import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { homeImages } from "@/components/marketing/images";
import { PRODUCTS, type ProductSlug } from "@/components/marketing/site-data";
import { ProductPage } from "@/components/marketing/pages/product";
import { getT } from "@/i18n/server";
import { config } from "@/server/config";

const isProduct = (s: string): s is ProductSlug => (PRODUCTS as readonly string[]).includes(s);

export function generateStaticParams() {
  return PRODUCTS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!isProduct(slug)) return {};
  const t = await getT();
  return { title: t.front.product[slug].meta };
}

/** Approvals, Rules, Activity, Agents and Checks: one page each, with screens a visitor can click. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isProduct(slug)) notFound();
  return <ProductPage slug={slug} accounts={config.accounts} demo={config.accounts && !!config.demoAccount} images={homeImages()} />;
}
