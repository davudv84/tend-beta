"use client";

import { useId, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Progressive disclosure, one pattern for the whole product: "Details" opens in place, in 240ms, without moving anything
 * else. `open` starts from the person's "show details by default" preference until they open or close it themselves.
 * Only the amount of detail changes here: nothing a person needs in order to decide is ever put inside one.
 */
export function Disclosure({ summary, open: initial = false, children, className }: { summary: string; open?: boolean; children: React.ReactNode; className?: string }) {
  const id = useId();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? initial;
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setChosen(!open)}
        className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-1 text-small text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRightIcon className={cn("size-3.5 transition-transform duration-200 ease-[var(--ease-out)]", open && "rotate-90")} aria-hidden />
        {summary}
      </button>
      <div
        id={id}
        inert={!open}
        className={cn("grid transition-[grid-template-rows,opacity] duration-[240ms] ease-[var(--ease-out)]", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}
      >
        <div className="overflow-hidden">
          <div className="pt-2 pb-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
