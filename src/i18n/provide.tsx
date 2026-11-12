"use client";

import dynamic from "next/dynamic";
import type { Locale } from "./config";

// Each language's provider is its own chunk, rendered on the server and loaded in the browser only for the language shown, so a page
// carries one dictionary instead of both. (Imported statically from the layout, webpack would put both into the layout's bundle.)
const ProvideDE = dynamic(() => import("./provide-de"));
const ProvideEN = dynamic(() => import("./provide-en"));

export function Provide({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return locale === "de" ? <ProvideDE>{children}</ProvideDE> : <ProvideEN>{children}</ProvideEN>;
}
