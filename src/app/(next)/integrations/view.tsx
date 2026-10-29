"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { IntegrationLogo } from "@/components/integration-logo";
import { SampleAgent } from "@/components/sample-agent";
import { SignIn } from "@/components/sign-in";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { timeAgo, useNow } from "@/lib/format";
import { INTEGRATIONS, STATUS_ORDER, liveStatus, matches, type Integration, type IntegrationCategory, type IntegrationStatus } from "@/lib/integrations-catalog";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Page, PageSkeleton } from "@/ui/page";

const CATEGORIES: IntegrationCategory[] = ["provider", "agent", "framework", "protocol"];
const BADGE: Record<IntegrationStatus, string> = {
  verified: "border-primary/25 bg-primary/[0.07] text-primary",
  compatible: "border-border bg-background text-muted-foreground",
  planned: "border-dashed border-border bg-background text-faint",
};
// Verified first, then compatible, then planned; catalog order within each.
const SORTED = [...INTEGRATIONS].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

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
  const [st, setSt] = useState<IntegrationStatus | "all">("all");
  const [open, setOpen] = useState<Integration | null>(null);
  const shown = useMemo(() => SORTED.filter((i) => (cat === "all" || i.category === cat) && (st === "all" || i.status === st) && matches(i, d.items[i.id].summary, q)), [cat, st, q, d]);
  if (status === "signin") return <Page><SignIn compact /></Page>;
  if (!ready) return <PageSkeleton label={t.home.loading} />;

  const badge = (s: IntegrationStatus) => <span className={cn("rounded-full border px-2 py-0.5 text-caption whitespace-nowrap", BADGE[s])}>{d.status[s]}</span>;
  const chips = <V extends string>(label: string, value: V | "all", set: (v: V | "all") => void, options: V[], text: (v: V) => string) => (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {(["all", ...options] as const).map((o) => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => set(o)}
          className={cn("h-8 rounded-full border px-3 text-small transition-colors", value === o ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:text-foreground")}>
          {o === "all" ? d.all : text(o)}
        </button>
      ))}
    </div>
  );
  const item = open ? d.items[open.id] : null;
  const live = open ? liveStatus(open, agents, taskEvents) : null;

  return (
    <Page>
      <header>
        <h1 className="text-section text-balance">{d.title}</h1>
        <p className="mt-4 max-w-[60ch] text-lead text-pretty text-muted-foreground">{d.description}</p>
      </header>

      <div className="mt-8 grid gap-3">
        <div className="relative">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input type="search" aria-label={d.search} placeholder={d.search} value={q} onChange={(e) => setQ(e.target.value)} className="h-10 rounded-xl pl-9 text-ui" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          {chips(d.categoryLabel, cat, setCat, CATEGORIES, (c) => d.categories[c])}
          {chips(d.statusLabel, st, setSt, STATUS_ORDER, (s) => d.status[s])}
        </div>
        <p className="text-caption text-faint" aria-live="polite">{d.count(shown.length, INTEGRATIONS.length)}</p>
      </div>

      {shown.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <p className="text-body text-muted-foreground">{d.none}</p>
          <Button variant="secondary" className="mt-4 h-9 rounded-full border-border px-4 text-small" onClick={() => { setQ(""); setCat("all"); setSt("all"); }}>{d.clear}</Button>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => setOpen(i)} aria-label={d.open(i.name)}
                className="flex h-full w-full flex-col gap-3 rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-foreground/25 hover:bg-sunken/40 focus-visible:outline-2 focus-visible:outline-primary">
                <span className="flex w-full items-start justify-between gap-3">
                  <IntegrationLogo entry={i} />
                  {badge(i.status)}
                </span>
                <span className="min-w-0">
                  <span className="block text-ui font-semibold">{i.name}</span>
                  <span className="block text-caption text-faint">{d.categories[i.category]}</span>
                  <span className="mt-1.5 line-clamp-2 block text-small text-pretty text-muted-foreground">{d.items[i.id].summary}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 max-w-[70ch] text-caption text-faint">{d.trademarks}</p>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open && item && live && (
          <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-6 sm:max-w-lg">
            <div className="flex items-start gap-4 pr-8">
              <IntegrationLogo entry={open} className="size-12" />
              <div className="min-w-0">
                <DialogTitle className="text-h2 leading-snug">{open.name}</DialogTitle>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">{badge(open.status)}<span className="text-caption text-faint">{d.categories[open.category]}</span></div>
              </div>
            </div>
            <DialogDescription className="mt-4 text-body text-pretty text-muted-foreground">{item.summary}</DialogDescription>
            <dl className="mt-5 grid gap-4 border-t border-border pt-5 text-small">
              <div><dt className="text-faint">{d.how}</dt><dd className="mt-1 text-pretty">{(item as { how?: string }).how ?? d.plannedHow}</dd></div>
              <div>
                <dt className="text-faint">{d.evidence}</dt>
                <dd className="mt-1 text-pretty">
                  {open.evidence ? <>{d.evidenceKind[open.evidence.kind]} · {open.evidence.date}<span className="mt-1 block font-mono text-caption break-words text-muted-foreground">{open.evidence.test}</span></> : d.untested}
                </dd>
              </div>
              {open.status !== "planned" && (
                <div><dt className="text-faint">{d.usage}</dt><dd className="mt-1">{d.here(live.count, live.lastVerifiedAt ? timeAgo(live.lastVerifiedAt, now) : null)}{open.provider === "Custom" && live.count > 0 ? ` ${d.custom}` : ""}</dd></div>
              )}
              <div><dt className="text-faint">{d.statusLabel}</dt><dd className="mt-1">{d.statusHelp[open.status]}</dd></div>
            </dl>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" className="h-10 rounded-full border-border px-5 text-small" onClick={() => setOpen(null)}>{d.close}</Button>
              {open.connect && canAct && (
                <Button asChild className="h-10 rounded-full px-5 text-small"><Link href={`/connect?provider=${open.id}`}>{d.connect}</Link></Button>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>

      {canAct && <SampleAgent />}
    </Page>
  );
}
