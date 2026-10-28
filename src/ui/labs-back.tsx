"use client";

import { useT } from "@/i18n/client";
import { BackLink } from "@/ui/page";

/** The way back from a research experiment to the Labs index. */
export function LabsBack() {
  const t = useT();
  return <div className="mb-8"><BackLink href="/labs" label={t.ui.footer.labs} /></div>;
}
