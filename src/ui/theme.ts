"use client";

import { useEffect } from "react";
import type { ThemePref } from "@/ui/prefs";

/**
 * Keep the components' `dark:` styles in step with the theme in use. Screens that have not been redesigned are dark only,
 * so the class is put back as soon as the redesigned screen goes away.
 */
export function useDocumentTheme(theme: ThemePref) {
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
    apply();
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
      document.documentElement.classList.add("dark");
    };
  }, [theme]);
}
