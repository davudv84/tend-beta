"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { SampleAgent } from "@/components/sample-agent";
import { SignIn } from "@/components/sign-in";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { timeAgo, useNow } from "@/lib/format";
import { INTEGRATIONS, STATUS_ORDER, liveStatus, matches, type Integration, type IntegrationCategory, type IntegrationStatus } from "@/lib/integrations-catalog";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Disclosure } from "@/ui/disclosure";
import { Page, PageSkeleton } from "@/ui/page";

const CATEGORIES: IntegrationCategory[] = ["sdk", "protocol", "api", "framework"];
const BADGE: Record<IntegrationStatus, string> = {
  verified: "border-primary/25 bg-primary/[0.07] text-primary",
  compatible: "border-border bg-background text-muted-foreground",
  planned: "border-dashed border-border bg-background text-faint",
};

/** The integration directory: what exists, what each claim rests on, and what is connected to this TEND. Nothing here is a fake success. */
export default function View() {
  const t = useT();
  const d = t.integrations;
  const ready = useStore((s) => s.ready);
  const status = useStore((s) => s.status);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const agents = useStore((s) => s.agents);
  const taskEvents = useStore((s) => s.taskEvents);
  const skew = useStore((s) => s.skew);
  const now = useNow() + skew;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<IntegrationCategory | "all">("all");
  const shown = useMemo(() => INTEGRATIONS.filter((i) => (cat === "all" || i.category === cat) && matches(i, d.items[i.id].summary, q)), [cat, q, d]);
  if (status === "signin") return <Page><SignIn compact /></Page>;
  if (!ready) return <PageSkeleton label={t.home.loading} />;

  const row = (i: Integration) => {
    const live = liveStatus(i, agents, taskEvents);
    return (
      <li key={i.id} className="flex items-start gap-4 border-t border-border py-5 first:border-t-0">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-sunken font-mono text-small font-semibold text-foreground">{i.monogram}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="text-ui font-semibold">{i.name}</h3>
            <span className={cn("rounded-full border px-2 py-0.5 text-caption", BADGE[i.status])}>{d.status[i.status]}</span>
            <span className="text-caption text-faint">{d.categories[i.category]}</span>
          </div>
          <p className="mt-1 max-w-[64ch] text-small text-pretty text-muted-foreground">{d.items[i.id].summary}</p>
          {i.status !== "planned" && (
            <p className="mt-1.5 text-caption text-faint">
              {d.here(live.count, live.lastVerifiedAt ? timeAgo(live.lastVerifiedAt, now) : null)}
              {i.provider === "Custom" && live.count > 0 ? ` ${d.custom}` : ""}
            </p>
          )}
          <Disclosure summary={d.details} className="mt-2">
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-small">
              <dt className="text-faint">{d.how}</dt><dd className="text-pretty">{d.items[i.id].how}</dd>
              <dt className="text-faint">{d.evidence}</dt>
              <dd className="text-pretty">{i.evidence ? <>{d.evidenceKind[i.evidence.kind]} · {i.evidence.date} · <span className="font-mono text-caption break-words">{i.evidence.test}</span></> : d.statusHelp.planned}</dd>
            </dl>
          </Disclosure>
        </div>
        {i.connect && canAct && (
          <Button asChild variant="secondary" className="h-9 shrink-0 rounded-full border-border px-4 text-small"><Link href={`/connect?provider=${i.id}`}>{d.connect}</Link></Button>
        )}
      </li>
    );
  };

  return (
    <Page>
      <header>
        <h1 className="text-section text-balance">{d.title}</h1>
        <p className="mt-4 max-w-[60ch] text-lead text-pretty text-muted-foreground">{d.description}</p>
      </header>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input type="search" aria-label={d.search} placeholder={d.search} value={q} onChange={(e) => setQ(e.target.value)} className="h-10 rounded-xl pl-9 text-ui" />
        </div>
        <div role="group" aria-label={d.title} className="flex flex-wrap gap-1.5">
          {(["all", ...CATEGORIES] as const).map((c) => (
            <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}
              className={cn("h-9 rounded-full border px-3.5 text-small transition-colors", cat === c ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:text-foreground")}>
              {c === "all" ? d.all : d.categories[c]}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 && <p className="mt-10 text-body text-muted-foreground">{d.none}</p>}
      {STATUS_ORDER.map((s) => {
        const items = shown.filter((i) => i.status === s);
        if (!items.length) return null;
        return (
          <section key={s} aria-labelledby={`int-${s}`} className="mt-10">
            <h2 id={`int-${s}`} className="text-title">{d.status[s]}</h2>
            <p className="mt-1 text-small text-muted-foreground">{d.statusHelp[s]}</p>
            <ul className="mt-3 rounded-xl border border-border bg-background px-5">{items.map(row)}</ul>
          </section>
        );
      })}
      {canAct && <SampleAgent />}
    </Page>
  );
}
