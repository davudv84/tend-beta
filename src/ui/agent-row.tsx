"use client";

import Link from "next/link";
import { useT } from "@/i18n/client";
import { clock } from "@/lib/format";
import { connectionOf, protectionOf } from "@/lib/home";
import type { Agent } from "@/lib/types";
import type { VerificationRun } from "@/lib/verification";
import { assistantStatus } from "@/ui/assistant-status";
import { Badge, type Tone } from "@/ui/primitives";

/** One agent: who it is, how it is connected, what its checks last showed, and when. The badge says it in a word. */
export function AgentRow({ agent: a, run, now }: { agent: Agent; run: VerificationRun | null | undefined; now: number }) {
  const t = useT();
  const o = t.home.overview;
  const p = protectionOf(a, run);
  const st = assistantStatus(t, a, run, now);
  const badge: [Tone, string] =
    a.status === "paused" || !a.integrationEnabled ? ["danger", o.badge.paused]
    : connectionOf(a, now) !== "connected" ? ["neutral", o.badge.disconnected]
    : p.state === "attention" ? ["attention", o.badge.attention]
    : p.state === "ran" ? ["good", o.badge.verified]
    : ["neutral", o.badge.unverified];
  return (
    <li>
      <Link href={`/agents/${a.id}`} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-[#fafafa] dark:hover:bg-sunken">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-[#fafafa] text-[12px] font-semibold dark:bg-sunken">{a.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{a.name}</span>
          <span className="block truncate text-[14px] text-muted-foreground">{st.line}{st.second ? ` · ${st.second}` : ""}</span>
        </span>
        <span className="grid shrink-0 justify-items-end gap-1">
          <Badge tone={badge[0]}>{badge[1]}</Badge>
          <span className="text-[13px] text-muted-foreground">{run ? o.checkedAt(clock(run.at)) : o.neverChecked}</span>
        </span>
      </Link>
    </li>
  );
}
