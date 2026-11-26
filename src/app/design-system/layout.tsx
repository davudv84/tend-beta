import { notFound } from "next/navigation";
import { siteOnly } from "@/lib/site-only";
import type { Metadata } from "next";
import "@/design-system/tokens.css";

export const metadata: Metadata = {
  title: "Design system",
  description: "TEND design system 2.0: tokens, components and motion. Internal reference.",
  robots: { index: false, follow: false },
};

export default function DesignSystemLayout({ children }: { children: React.ReactNode }) {
  if (siteOnly()) notFound(); // site-only showcase: not part of it
  return children;
}
