"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRightIcon } from "lucide-react";
import { describe } from "@/components/agent-callout";
import { useT } from "@/i18n/client";
import { useNow } from "@/lib/format";
import { journal } from "@/lib/reflections";
import { useStore } from "@/lib/store";
import { AgentFigure } from "@/sanctuary/figure";
import { Sanctuary, type Anchor, type Places } from "@/sanctuary/sanctuary";

/** Fades a block in once as it scrolls into view. */
export function Reveal({ children, delay = 0, className, as = "div" }: { children: React.ReactNode; delay?: number; className?: string; as?: "div" | "li" }) {
  const M = as === "li" ? motion.li : motion.div;
  return (
    <M className={className} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </M>
  );
}

/** The live Sanctuary as the hero. Selecting a figure shows a small card that links into the app. */
export function HeroSanctuary() {
  const t = useT();
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const skew = useStore((s) => s.skew);
  const now = useNow();
  const [selected, setSelected] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [places, setPlaces] = useState<Places>({});
  const agent = selected ? agents.find((a) => a.id === selected) : undefined;
  const d = agent && describe(t, agent, { working: !!tasks[agent.id], place: places[agent.id]?.place, walking: places[agent.id]?.walking, now: now + skew });

  return (
    <div className="relative h-[58vh] min-h-[360px] w-full md:h-[72vh]">
      <Sanctuary className="absolute inset-0" selected={selected} onSelect={setSelected} onAnchor={setAnchor} onPlaces={setPlaces} />
      {agent && anchor && d && (
        <motion.div key={agent.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
          className="absolute z-10 w-60 border border-[#3a362f] bg-[#13120f] p-4 shadow-[0_20px_50px_-20px_rgb(0_0_0/0.8)]"
          style={{ left: Math.max(12, Math.min(anchor.w - 252, anchor.x - 120)), top: Math.max(12, anchor.y - 168) }}>
          <div className="flex items-center gap-3">
            <AgentFigure id={agent.id} crop scale={2} />
            <div>
              <p className="text-ui font-medium">{agent.name}</p>
              <p className="font-mono text-meta text-faint">{agent.model} · {agent.origin === "connected" ? t.origin.connected : t.origin.simulated}</p>
            </div>
          </div>
          <p className="mt-3 text-small">{d.state}</p>
          <p className="text-small text-muted-foreground">{d.where}</p>
          <Link href={`/sanctuary?agent=${agent.id}`} className="group mt-3 flex items-center justify-between border-t border-border pt-3 text-small text-muted-foreground hover:text-foreground">
            {t.landing.heroOpen} <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </motion.div>
      )}
    </div>
  );
}

/** Three recent reflections from the live (simulated) journal. */
export function ReflectionsShowcase() {
  const t = useT();
  const ready = useStore((s) => s.ready);
  const agents = useStore((s) => s.agents);
  const checkIns = useStore((s) => s.checkIns);
  if (!ready) return <div className="h-80" />;
  const entries = journal(checkIns).slice(0, 3);
  const name = (id: string) => agents.find((a) => a.id === id);
  const [lead, ...rest] = entries;
  if (!lead) return null;
  return (
    <div>
      <Reveal>
        <figure className="mx-auto max-w-3xl">
          <div className="flex items-center gap-3">
            <AgentFigure id={lead.checkIn.agentId} crop scale={2} />
            <p className="text-small"><span className="font-medium text-foreground">{name(lead.checkIn.agentId)?.name}</span> <span className="text-faint">· {name(lead.checkIn.agentId)?.model}</span></p>
            <span className="ml-auto font-mono text-meta text-faint">{t.landing.notes.note(lead.number)}</span>
          </div>
          <blockquote className="quote mt-6 text-quote-lg text-foreground">{t.quote(lead.checkIn.reflection ?? "")}</blockquote>
          <figcaption className="mt-5 font-mono text-meta text-faint">{t.landing.notes.caption(t.sources[lead.checkIn.source], lead.checkIn.review ? t.review.word[lead.checkIn.review.status] : t.review.notRequired)}</figcaption>
        </figure>
      </Reveal>
      <div className="mx-auto mt-16 grid max-w-3xl gap-10 border-t border-border pt-10 md:grid-cols-2">
        {rest.map((e, i) => (
          <Reveal key={e.checkIn.id} delay={0.08 * i}>
            <p className="text-small"><span className="font-medium">{name(e.checkIn.agentId)?.name}</span> <span className="font-mono text-meta text-faint">· {e.number}</span></p>
            <blockquote className="quote mt-3 text-quote text-foreground/85">{t.quote(e.checkIn.reflection ?? "")}</blockquote>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
