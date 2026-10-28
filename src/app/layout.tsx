import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { getLocale, getT } from "@/i18n/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The shared-link card. Its image is app/opengraph-image.png; on Vercel, Next.js resolves it against the
// production domain (or the branch URL for previews), so no address is hardcoded here.
export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const card = { title: t.meta.title, description: t.meta.description };
  return {
    title: { default: t.meta.title, template: "%s · Tend" },
    description: t.meta.description,
    openGraph: { ...card, type: "website", siteName: "Tend", locale: locale === "de" ? "de_DE" : "en_US", alternateLocale: locale === "de" ? "en_US" : "de_DE" },
    twitter: { ...card, card: "summary_large_image" },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      data-scroll-behavior="smooth"
    >
      <body className="min-h-full flex flex-col">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
