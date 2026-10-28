"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { SignIn } from "@/components/sign-in";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { useNow } from "@/lib/format";
import { homeQueue, orderAssistants, realAssistants } from "@/lib/home";
import { useStore } from "@/lib/store";
import { AgentRow } from "@/ui/agent-row";
import { FirstRun } from "@/ui/first-run";
import { Page, PageSkeleton } from "@/ui/page";
import { Card, buttonClass } from "@/ui/primitives";
import { useRuns } from "@/ui/use-runs";

/** Search appears once a list is long enough to need it. */
const SEARCH_AT = 6;

export default function View() {
  const t = useT();
  const g = t.assistants;
  const h = t.home;
  const ready = useStore((s) => s.ready);
  const status = useStore((s) => s.status);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const agents = useStore((s) => s.agents);
  const authorizations = useStore((s) => s.authorizations);
  const skew = useStore((s) => s.skew);
  const now = useNow() + skew;
  const [q, setQ] = useState("");

  // Operators see their real assistants (samples live in Labs, as on Home); a public visitor sees what the server shares.
  const shown = useMemo(() => (canAct ? realAssistants(agents) : agents), [agents, canAct]);
  const sample = agents.length - realAssistants(agents).length;
  const runs = useRuns(useMemo(() => shown.map((a) => a.id), [shown]), ready && canAct);
  const waiting = useMemo(() => homeQueue(agents, authorizations, now).waiting, [agents, authorizations, now]);
  const ordered = useMemo(
    () => (canAct ? orderAssistants(agents, runs, waiting) : [...shown].sort((a, b) => a.name.localeCompare(b.name))),
    [agents, runs, waiting, canAct, shown],
  );
  const query = q.trim().toLowerCase();
  const list = query ? ordered.filter((a) => [a.name, a.role, a.model, a.provider].some((s) => s.toLowerCase().includes(query))) : ordered;

  if (status === "signin") return <Page><SignIn compact /></Page>;
  if (!ready) return <PageSkeleton label={h.loading} />;
  if (canAct && shown.length === 0) return <FirstRun title={h.headline.first} body={h.sub.first} sample={sample > 0} />;

  return (
    <Page full>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[40px] leading-[1.1] font-semibold tracking-[-0.03em]">{t.ui.nav.assistants}</h1>
          <p className="mt-3 text-[15px] text-muted-foreground">{g.sub}</p>
        </div>
        {canAct && <Link href="/connect" className={buttonClass()}>{g.register}</Link>}
      </header>

      <Card className="mt-8">
        {shown.length >= SEARCH_AT && (
          <div className="relative border-b border-border px-6 py-4">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-9 size-4 -translate-y-1/2 text-faint" strokeWidth={1.75} />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={g.search} aria-label={g.search} className="h-10 pl-9 text-[14px]" />
          </div>
        )}
        {list.length > 0 ? (
          <ul className="divide-y divide-border">{list.map((a) => <AgentRow key={a.id} agent={a} run={runs.get(a.id)} now={now} />)}</ul>
        ) : (
          <div className="px-6 py-14 text-center">
            <p className="text-[17px] font-semibold">{g.noMatchTitle}</p>
            <p className="mt-2 text-[14px] text-muted-foreground">{g.noMatchBody}</p>
            <Button variant="secondary" className="mt-5 h-10 border-border px-5 text-small" onClick={() => setQ("")}>{g.clear}</Button>
          </div>
        )}
      </Card>

      {canAct && sample > 0 && (
        <p className="mt-8 text-caption text-faint">{h.sampleNote(sample)} <Link href="/labs" className="text-primary underline-offset-4 hover:underline">{h.sampleLink}</Link></p>
      )}
    </Page>
  );
}
