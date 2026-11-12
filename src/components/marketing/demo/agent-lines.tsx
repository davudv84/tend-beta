"use client";

import { IntegrationLogo } from "@/components/integration-logo";
import { useT } from "@/i18n/client";
import type { Outcome } from "@/lib/activity";
import { INTEGRATIONS } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import { AGENT_LINES } from "../demo-data";

/**
 * The agents as the app's list draws them (ui/agent-row.tsx), from sample data: the product's mark, the name, the status word with the
 * live dot, the latest request with its prefix ("Waiting for you", "Not allowed"), and how long ago. Same markup, no store.
 */
/** `invoice`: how the waiting payment ended in the demo, so ops-agent's line follows it. */
export function AgentLines({ className, invoice }: { className?: string; invoice?: Outcome }) {
  const t = useT();
  const d = t.home.dash;
  return (
    <ul className={cn("divide-y divide-border", className)}>
      {AGENT_LINES.map((l) => {
        const entry = INTEGRATIONS.find((i) => i.id === l.integration) ?? { logo: undefined, category: "agent" as const };
        // ops-agent's latest request is the demo's payment: once answered, its line says how it ended, as the app's row does.
        const doing = l.agent.name === "ops-agent" && invoice && invoice !== "needs_approval" ? (invoice === "rejected" ? "rejected" : invoice === "expired" ? "expired" : undefined) : l.doing;
        const prefix = doing === "expired" ? t.timelinePage.outcome.expired : doing ? d.doing[doing] : "";
        return (
          <li key={l.agent.id} className="flex items-center gap-4 px-5 py-4">
            <IntegrationLogo entry={entry} className="size-9" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="truncate text-[15px] font-medium">{l.agent.name}</span>
                <span className={cn("inline-flex items-center gap-1.5 text-[13px]", l.live ? "text-foreground" : "text-muted-foreground")}>
                  <span aria-hidden className={cn("size-1.5 rounded-full", l.live ? "bg-primary" : "border border-muted-foreground")} />
                  {l.live ? d.word.active : d.word.idle}
                </span>
              </span>
              <span className={cn("mt-0.5 block truncate font-mono text-[13px]", doing === "waiting" ? "text-foreground" : "text-muted-foreground")}>
                {prefix && <span className="font-sans text-[14px]">{prefix}: </span>}{l.detail}
              </span>
            </span>
            <span className="hidden shrink-0 text-[13px] text-muted-foreground tabular-nums sm:block">{t.time.ago(l.minutesAgo, "m")}</span>
          </li>
        );
      })}
    </ul>
  );
}
