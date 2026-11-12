"use client";

import { I18nProvider } from "./client";
import { en } from "./en";

/** The interface in English: only this dictionary is in the page's bundle (the root layout picks the provider). */
export default function ProvideEN({ children }: { children: React.ReactNode }) {
  return <I18nProvider locale="en" dict={en}>{children}</I18nProvider>;
}
