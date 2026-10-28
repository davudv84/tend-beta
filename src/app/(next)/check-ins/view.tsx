"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { InboxIcon, PlusIcon } from "lucide-react";
import { CheckInRow } from "@/components/feed";
import { AgentSelect, Empty, PageHeader, Segmented } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { QUESTIONS } from "@/lib/contract";
import { useNow } from "@/lib/format";
import { useStore } from "@/lib/store";

type Filter = "all" | "flagged" | "pending";
const PAGE = 40;

export default function View() {
  const t = useT();
  const g = t.reportsPage;
  const params = useSearchParams();
  const agents = useStore((s) => s.agents);
  const checkIns = useStore((s) => s.checkIns);
  const now = useNow();
  const [agent, setAgent] = useState(params.get("agent") ?? "all");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);

  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const list = useMemo(
    () => checkIns.filter((c) =>
      (agent === "all" || c.agentId === agent) &&
      (filter === "all" || (filter === "flagged" ? !!c.review : c.review?.status === "pending"))),
    [checkIns, agent, filter],
  );

  return (
    <div>
      <PageHeader
        eyebrow={g.eyebrow}
        term={t.nav.items.checkIns.term}
        title={g.title}
        description={g.description}
        actions={<Button asChild size="lg"><Link href={`/check-ins/new${agent !== "all" ? `?agent=${agent}` : ""}`}><PlusIcon /> {g.new}</Link></Button>}
      />

      <details className="group mb-8 frame">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm [&::-webkit-details-marker]:hidden">
          <span><span className="font-medium">{g.protocol}</span> <span className="text-muted-foreground">{g.protocolNote}</span></span>
          <span className="pl-3 text-xs text-faint group-open:hidden">{g.show}</span>
          <span className="hidden pl-3 text-xs text-faint group-open:inline">{g.hide}</span>
        </summary>
        <ol className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
          {QUESTIONS.map((q, i) => (
            <li key={q.id} className="bg-background px-5 py-4">
              <span className="font-mono text-meta text-faint">{t.q(i + 1)}</span>
              <p className="mt-1.5 text-small leading-relaxed text-muted-foreground">{t.questions[q.id].text}</p>
            </li>
          ))}
        </ol>
      </details>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<Filter> label={g.filter} value={filter} onChange={(v) => { setFilter(v); setLimit(PAGE); }}
          options={[{ value: "all", label: g.all }, { value: "flagged", label: g.flagged }, { value: "pending", label: g.pending }]} />
        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-xs text-faint sm:inline">{g.results(list.length)}</span>
          <AgentSelect value={agent} onChange={(v) => { setAgent(v); setLimit(PAGE); }} />
        </div>
      </div>

      <div className="frame overflow-hidden">
        {list.length ? (
          <div className="divide-y divide-border">
            {list.slice(0, limit).map((c) => <CheckInRow key={c.id} checkIn={c} agent={byId.get(c.agentId)} now={now} />)}
          </div>
        ) : (
          <Empty icon={InboxIcon} title={g.emptyTitle} body={filter === "pending" ? g.emptyPending : g.emptyOther} />
        )}
        {list.length > limit && (
          <div className="border-t border-border p-3">
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setLimit((l) => l + PAGE)}>
              {t.common.showMore} <span className="font-mono text-xs text-faint">({t.common.remaining(list.length - limit)})</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
