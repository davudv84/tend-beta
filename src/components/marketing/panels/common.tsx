"use client";

import { LockIcon } from "lucide-react";
import { IntegrationLogo } from "@/components/integration-logo";
import { useT } from "@/i18n/client";
import { INTEGRATIONS } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import { Badge, type Tone } from "@/ui/primitives";
import { AGENTS, CHOICES, SPEND, type AgentKey, type Choice, type ToolId, type Verdict } from "../site-data";

// Small parts shared by the clickable screens: an agent's mark, a decision as the app's badge, and the Allow / Ask me first / Never
// choice as the app's permissions screen offers it.

export const TONE_OF: Record<Verdict, Tone> = { allow: "good", ask: "attention", never: "danger", unlisted: "danger" };

/** The mark of the product an agent runs on, from the integrations catalog. */
export function AgentMark({ agent, className }: { agent: AgentKey; className?: string }) {
  const a = AGENTS.find((x) => x.key === agent)!;
  const entry = INTEGRATIONS.find((i) => i.id === a.integration) ?? { logo: undefined, category: "agent" as const };
  return <IntegrationLogo entry={entry} className={cn("size-7 rounded-md", className)} />;
}

/** What TEND decided, as the app shows it: a word with a small mark. */
export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  const k = useT().front.kit;
  return <Badge tone={TONE_OF[verdict]} className={className}>{k.verdict[verdict]}</Badge>;
}

/** The three choices for one tool. Paying can't be set to Allow, as in the app. */
export function ChoicePicker({ tool, value, onChange, label, small }: { tool: ToolId; value: Choice; onChange: (c: Choice) => void; label: string; small?: boolean }) {
  const t = useT();
  const locked = SPEND.includes(tool);
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-lg border border-border bg-sunken/60 p-0.5">
      {CHOICES.map((c) => {
        const on = value === c;
        const off = locked && c === "allow";
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={off}
            onClick={() => onChange(c)}
            title={off ? t.front.kit.spendLocked : undefined}
            className={cn(
              "inline-flex items-center gap-1 rounded-md font-medium whitespace-nowrap outline-none transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40",
              small ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-[12px]",
              on ? (c === "allow" ? "bg-[rgb(141_187_165/0.18)] text-[#a6cbb8]" : c === "ask" ? "bg-[rgb(217_165_91/0.18)] text-[#e4ba7a]" : "bg-[rgb(217_128_106/0.2)] text-[#eba491]") : "text-muted-foreground hover:text-foreground",
            )}
          >
            {off && <LockIcon className="size-3" strokeWidth={2} aria-hidden />}
            {t.tools.choice[c]}
          </button>
        );
      })}
    </div>
  );
}
