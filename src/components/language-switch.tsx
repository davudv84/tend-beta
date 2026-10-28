"use client";

import { LOCALES } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

/** DE / EN. Saved in a cookie, so the server renders the next page in the chosen language too. */
export function LanguageSwitch({ className, stacked }: { className?: string; stacked?: boolean }) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  return (
    <div role="radiogroup" aria-label={t.lang.label} className={cn("inline-flex rounded-[5px] border border-border/70 p-0.5 font-mono text-meta", stacked && "flex-col", className)}>
      {LOCALES.map((l) => (
        <button key={l} type="button" role="radio" aria-checked={locale === l} lang={l} title={t.lang.names[l]} aria-label={t.lang.names[l]}
          onClick={() => locale !== l && setLocale(l)}
          className={cn("rounded-[3px] px-1.5 py-0.5 uppercase transition-colors", locale === l ? "bg-elevated text-foreground" : "text-faint hover:text-muted-foreground")}>
          {l}
        </button>
      ))}
    </div>
  );
}
