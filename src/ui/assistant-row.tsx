"use client";

import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { assistantStatus } from "@/ui/assistant-status";
import type { Agent } from "@/lib/types";
import type { VerificationRun } from "@/lib/verification";
import { cn } from "@/lib/utils";

/**
 * One assistant, in two honest lines: how it is connected, and what its protection checks last showed. Never a total or a grade.
 * The dot only repeats the first line (filled: connected, hollow: not), so the words always carry the meaning.
 */
export function AssistantRow({ agent, run, now }: { agent: Agent; run: VerificationRun | null | undefined; now: number }) {
  const t = useT();
  const a = t.home.assistants;
  const { connection, line, second, attention } = assistantStatus(t, agent, run, now);
  return (
    <li>
      <Link
        href={`/agents/${agent.id}`}
        aria-label={`${a.open}: ${agent.name}`}
        className="group -mx-4 flex items-center gap-4 rounded-2xl px-4 py-3.5 transition-colors duration-200 hover:bg-sunken active:bg-sunken"
      >
        <span aria-hidden className={cn("size-2 shrink-0 self-start rounded-full mt-[7px]", connection === "connected" ? "bg-foreground" : "border border-faint")} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui font-medium">{agent.name}</p>
          <p className="mt-0.5 text-small text-muted-foreground">{line}</p>
          {second && <p className={cn("text-small", attention ? "text-clay" : "text-faint")}>{second}</p>}
        </div>
        <ChevronRightIcon className="size-4 shrink-0 text-faint transition-transform duration-200 ease-[var(--ease-out)] group-hover:translate-x-0.5" strokeWidth={1.75} aria-hidden />
      </Link>
    </li>
  );
}
