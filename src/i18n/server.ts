import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, pickLocale, type Locale } from "./config";
import { DICTS, type Dict } from "./index";

/** The visitor's saved choice, else their browser's language. */
export async function getLocale(): Promise<Locale> {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(saved) ? saved : pickLocale((await headers()).get("accept-language"));
}

export const getT = async () => DICTS[await getLocale()];

/** `export const generateMetadata = pageTitle("agents")` gives a page its title in the visitor's language. */
export const pageTitle = (key: keyof Dict["meta"]["pages"]) => async (): Promise<Metadata> => ({ title: (await getT()).meta.pages[key] });
