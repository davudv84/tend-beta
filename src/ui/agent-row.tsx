"use client";

import Link from "next/link";
import { hookOf } from "@/components/assistant-connect";
import { IntegrationLogo } from "@/components/integration-logo";
import { useT } from "@/i18n/client";
import { timeAgo } from "@/lib/format";
import { INTEGRATIONS } from "@/lib/integrations-catalog";
import { presenceOf } from "@/lib/protection";
import type { Agent, Authorization } from "@/lib/types";
import type { VerificationRun } from "@/lib/verification";
import { cn } from "@/lib/utils";
import { assistantStatus } from "@/ui/assistant-status";

const PROVIDER_ENTRY: Record<string, string> = { Anthropic: "claude", Google: "gemini", OpenAI: "openai" };
/** The product's own mark when TEND knows which product it is; otherwise a neutral glyph, never invented letters. */
export const entryOf = (a: Agent) => INTEGRATIONS.find((i) => i.id === (hookOf(a) ?? PROVIDER_ENTRY[a.provider])) ?? { logo: undefined, category: "agent" as const };

/** The agent's most recent request to TEND, which is what it is doing now, or did last. */
export const lastRequest = (authorizations: Authorization[], agentId: string) =>
  authorizations.reduce<Authorization | undefined>((m, a) => (a.agentId === agentId && (!m || a.createdAt > m.createdAt) ? a : m), undefined);

/**
 * One agent in a line: its mark and name, whether it is active (a word, with the live dot only when TEND heard from it in the last
 * few minutes), and what it is doing, from its latest real request. Nothing here is estimated.
 */
export function AgentRow({ agent: a, run, now, last }: { agent: Agent; run: VerificationRun | null | undefined; now: number; last?: Authorization }) {
  const t = useT();
  const d = t.home.dash;
  const st = assistantStatus(t, a, run, now);
  const presence = presenceOf(a, now);
  const paused = a.status === "paused" || !a.integrationEnabled;
  const word = paused ? d.word.paused : presence === "running" ? d.word.active : presence === "quiet" ? d.word.idle : d.word[presence];
  // A request that did not run says so; one that ran or is allowed is just the request itself.
  const prefix = last?.status === "pending" ? d.doing.waiting : last?.status === "denied" ? d.doing.blocked : last?.status === "rejected" ? d.doing.rejected : last?.status === "expired" ? t.timelinePage.outcome.expired : "";
  const doing = last ? <>{prefix && <span className="font-sans text-[14px]">{prefix}: </span>}{last.detail ?? `${last.tool} · ${last.action}`}</> : presence === "never" ? d.doing.setup : d.doing.none;
  const live = !paused && presence === "running";
  return (
    <li>
      <Link href={`/agents/${a.id}`} className="flex items-center gap-4 px-5 py-4 outline-none transition-colors hover:bg-black/[0.025] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary dark:hover:bg-white/[0.04]">
        <IntegrationLogo entry={entryOf(a)} className="size-9" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="truncate text-[15px] font-medium">{a.name}</span>
            <span className={cn("inline-flex items-center gap-1.5 text-[13px]", live ? "text-foreground" : "text-muted-foreground")}>
              <span aria-hidden className={cn("size-1.5 rounded-full", live ? "bg-primary" : paused ? "bg-clay" : "border border-muted-foreground")} />
              {word}
            </span>
          </span>
          <span className={cn("mt-0.5 block truncate text-[14px]", last?.status === "pending" ? "text-foreground" : "text-muted-foreground", last && "font-mono text-[13px]")}>{doing}</span>
          {st.attention && <span className="mt-0.5 block text-[13px] text-clay">{st.second}</span>}
        </span>
        {last && <span className="hidden shrink-0 text-[13px] text-muted-foreground tabular-nums sm:block">{timeAgo(last.createdAt, now)}</span>}
      </Link>
    </li>
  );
}
