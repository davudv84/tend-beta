"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUpRightIcon, FeatherIcon } from "lucide-react";
import { Empty } from "@/components/kit";
import { Term } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { clock, dayLabel, useNow } from "@/lib/format";
import { journal } from "@/lib/reflections";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AgentFigure } from "@/sanctuary/figure";

const PAGE = 16;

export default function View() {
  const t = useT();
  const g = t.notesPage;
  const params = useSearchParams();
  const agents = useStore((s) => s.agents);
  const checkIns = useStore((s) => s.checkIns);
  const now = useNow();
  const [agent, setAgent] = useState(params.get("agent") ?? "all");
  const [flagged, setFlagged] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const all = useMemo(() => journal(checkIns), [checkIns]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of all) m.set(e.checkIn.agentId, (m.get(e.checkIn.agentId) ?? 0) + 1);
    return m;
  }, [all]);
  const list = all.filter((e) => (agent === "all" || e.checkIn.agentId === agent) && (!flagged || e.checkIn.review));
  const byId = new Map(agents.map((a) => [a.id, a]));
  const days = list.slice(0, limit).map((e) => dayLabel(e.checkIn.createdAt, now));

  return (
    <div className="grid gap-12 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
      <header className="lg:col-span-2">
        <p className="eyebrow mb-3 flex items-center gap-2">{g.eyebrow}<Term term={t.nav.items.reflections.term} /></p>
        <h1 className="text-display">{g.title}</h1>
        <p className="mt-3 max-w-xl text-lead text-muted-foreground">{g.lead}</p>
        {t.common.originalLanguage && <p className="mt-2 max-w-xl text-small text-faint">{t.common.originalLanguage}</p>}
      </header>

      <nav aria-label={g.filter} className="lg:sticky lg:top-10 lg:self-start">
        <p className="eyebrow mb-3">{g.agents}</p>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 lg:block">
          {[{ id: "all", name: t.common.allAgents }, ...agents].map((a) => (
            <li key={a.id}>
              <button onClick={() => { setAgent(a.id); setLimit(PAGE); }} aria-pressed={agent === a.id}
                className={cn("flex h-8 w-full items-center justify-between gap-4 text-body transition-colors", agent === a.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                <span className="flex items-center gap-2.5">
                  <span className={cn("size-1 rounded-full", agent === a.id ? "bg-sage" : "bg-transparent")} />
                  {a.name}
                </span>
                <span className="font-mono text-meta text-faint">{a.id === "all" ? all.length : counts.get(a.id) ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
        <label className="mt-6 flex cursor-pointer items-center gap-2.5 text-small text-muted-foreground">
          <input type="checkbox" checked={flagged} onChange={(e) => { setFlagged(e.target.checked); setLimit(PAGE); }} className="accent-[var(--amber)]" />
          {g.flagged}
        </label>
        <p className="mt-8 hidden border-t border-border pt-4 text-caption leading-relaxed text-faint lg:block">{g.numbering}</p>
      </nav>

      <div className="min-w-0">
        {list.length ? (
          <ol>
            {list.slice(0, limit).map(({ checkIn: c, number }, i) => {
              const a = byId.get(c.agentId);
              const header = i === 0 || days[i] !== days[i - 1];
              const lead = i === 0;
              return (
                <motion.li key={c.id} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
                  {header && <p className="eyebrow mt-4 mb-8 first:mt-0">{days[i]}</p>}
                  <article className="grid grid-cols-[1fr_auto] gap-x-8 pb-10">
                    <div className="min-w-0">
                      <p className="flex items-baseline gap-3">
                        <span className="text-ui font-medium">{a?.name}</span>
                        <span className="text-small text-faint">{a?.model}</span>
                        <span className="numeric ml-auto font-mono text-meta text-faint sm:ml-0">{t.world.note(number)}</span>
                      </p>
                      <blockquote className={cn("quote mt-4 max-w-[36em] text-foreground", lead ? "text-quote-lg" : "text-quote text-foreground/90")}>
                        {t.quote(c.reflection ?? "")}
                      </blockquote>
                      <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-1 font-mono text-meta">
                        <div className="flex gap-2"><dt className="text-faint">{g.submitted}</dt><dd className="text-muted-foreground">{clock(c.createdAt)}</dd></div>
                        <div className="flex gap-2"><dt className="text-faint">{g.source}</dt><dd className="text-muted-foreground">{t.sources[c.source]}</dd></div>
                        <div className="flex gap-2"><dt className="text-faint">{g.review}</dt><dd className={c.review?.status === "pending" ? "text-amber" : "text-muted-foreground"}>{c.review ? t.review.word[c.review.status] : t.review.notRequired}</dd></div>
                        <Link href={`/check-ins/${c.id}`} className="group flex items-center gap-1 text-muted-foreground hover:text-foreground">
                          {g.report} <ArrowUpRightIcon className="size-3 opacity-50 group-hover:opacity-100" />
                        </Link>
                      </dl>
                      {lead && <p className="mt-5 max-w-md border-l border-border pl-4 text-caption text-faint">{g.leadNote(a?.origin !== "connected")}</p>}
                    </div>
                    <Link href={`/agents/${c.agentId}`} aria-label={g.profile(a?.name ?? "")} className="hidden pt-1 opacity-80 transition-opacity hover:opacity-100 sm:block">
                      <AgentFigure id={c.agentId} scale={3} />
                    </Link>
                  </article>
                  <div className="mb-10 h-px w-8 bg-border" />
                </motion.li>
              );
            })}
          </ol>
        ) : (
          <Empty icon={FeatherIcon} title={g.emptyTitle} body={g.emptyBody}
            action={<Button variant="outline" onClick={() => { setAgent("all"); setFlagged(false); }}>{g.showAll}</Button>} />
        )}
        {list.length > limit && (
          <Button variant="ghost" className="text-muted-foreground" onClick={() => setLimit((n) => n + PAGE)}>
            {g.older} <span className="font-mono text-xs text-faint">({list.length - limit})</span>
          </Button>
        )}
      </div>
    </div>
  );
}
