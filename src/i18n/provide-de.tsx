"use client";

import { I18nProvider } from "./client";
import { de } from "./de";

/** The interface in German: only this dictionary is in the page's bundle (the root layout picks the provider). */
export default function ProvideDE({ children }: { children: React.ReactNode }) {
  return <I18nProvider locale="de" dict={de}>{children}</I18nProvider>;
}
