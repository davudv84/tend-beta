"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckIcon, SearchIcon, XIcon } from "lucide-react";
import { IntegrationLogo } from "@/components/integration-logo";
import { SampleAgent } from "@/components/sample-agent";
import { SignIn } from "@/components/sign-in";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { shortDate, timeAgo, useNow } from "@/lib/format";
import { INTEGRATIONS, SCENARIOS, STATUS_ORDER, liveStatus, matches, shownStatus, verificationOf, type Integration, type IntegrationCategory, type IntegrationStatus } from "@/lib/integrations-catalog";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Page, PageSkeleton } from "@/ui/page";

const CATEGORIES: IntegrationCategory[] = ["provider", "agent", "framework", "protocol"];
const BADGE: Record<IntegrationStatus, string> = {
  verified: "border-primary/25 bg-primary/[0.07] text-primary",
  connected: "border-primary/25 bg-background text-primary",
  compatible: "border-border bg-background text-muted-foreground",
  blocked: "border-border bg-sunken text-muted-foreground",
  planned: "border-dashed border-border bg-background text-faint",
};
const day = (iso?: string) => (iso ? shortDate(Date.parse(iso)) : null);

/** The integration directory. Every status comes from the verification report or from what is connected here; nothing is a fake success. */
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
  const rows = useMemo(() => INTEGRATIONS.map((i) => {
    const live = liveStatus(i, agents, taskEvents);
    return { i, live, shown: shownStatus(i, live.shared ? 0 : live.count), v: verificationOf(i) };
  }).sort((a, b) => STATUS_ORDER.indexOf(a.shown) - STATUS_ORDER.indexOf(b.shown)), [agents, taskEvents]);
  const shown = rows.filter((r) => (cat === "all" || r.i.category === cat) && (st === "all" || r.shown === st) && matches(r.i, d.items[r.i.id].summary, q));
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
  const footer = (r: (typeof rows)[number]) =>
    r.shown === "verified" ? d.lastTestShort(day(r.v?.verifiedAt) ?? "") : r.shown === "connected" ? d.connectedShort(r.live.count) : r.shown === "blocked" ? d.needsShort : r.shown === "compatible" ? d.notRun : "";
  const connectLink = (i: Integration, className: string) => i.connect && canAct && (
    <Link href={`/connect?provider=${i.id}`} className={className}>{d.connect}</Link>
  );
  const sel = open && rows.find((r) => r.i.id === open.id);
  const item = sel ? d.items[sel.i.id] : null;

  return (
    <Page>
      <header>
        <h1 className="text-section text-balance">{d.title}</h1>
        <p className="mt-4 max-w-[62ch] text-lead text-pretty text-muted-foreground">{d.description}</p>
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
          {shown.map((r) => (
            <li key={r.i.id} className="relative flex flex-col gap-3 rounded-xl border border-border bg-background p-4 transition-colors focus-within:border-foreground/40 hover:border-foreground/25 hover:bg-sunken/40">
              <span className="flex items-start justify-between gap-3">
                <IntegrationLogo entry={r.i} />
                {badge(r.shown)}
              </span>
              <span className="min-w-0">
                {/* The title button covers the whole card, so the card opens the details; the Connect link sits above it. */}
                <h3 className="text-ui font-semibold">
                  <button type="button" onClick={() => setOpen(r.i)} aria-label={d.open(r.i.name)} className="text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">{r.i.name}</button>
                </h3>
                <span className="block text-caption text-faint">{d.categories[r.i.category]}</span>
                <span className="mt-1.5 line-clamp-2 block text-small text-pretty text-muted-foreground">{d.items[r.i.id].summary}</span>
              </span>
              <span className="mt-auto flex min-h-7 items-center justify-between gap-3 text-caption text-faint">
                <span>{footer(r)}</span>
                {connectLink(r.i, "relative z-10 rounded-full border border-border px-3 py-1 text-caption text-foreground transition-colors hover:border-foreground/40")}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 max-w-[70ch] text-caption text-faint">{d.trademarks}</p>

      <Dialog open={!!sel} onOpenChange={(o) => !o && setOpen(null)}>
        {sel && item && (
          <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-6 sm:max-w-lg">
            <div className="flex items-start gap-4 pr-8">
              <IntegrationLogo entry={sel.i} className="size-12" />
              <div className="min-w-0">
                <DialogTitle className="text-h2 leading-snug">{sel.i.name}</DialogTitle>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">{badge(sel.shown)}<span className="text-caption text-faint">{d.categories[sel.i.category]}</span></div>
              </div>
            </div>
            <DialogDescription className="mt-4 text-body text-pretty text-muted-foreground">{item.summary}</DialogDescription>
            <dl className="mt-5 grid gap-4 border-t border-border pt-5 text-small">
              <div><dt className="text-faint">{d.verification}</dt><dd className="mt-1 text-pretty">{d.statusHelp[sel.shown]}</dd></div>
              <div><dt className="text-faint">{d.how}</dt><dd className="mt-1 text-pretty">{(item as { how?: string }).how ?? d.plannedHow}</dd></div>
              {sel.i.connect && (
                <div>
                  <dt className="text-faint">{d.connection}</dt>
                  <dd className="mt-1">{d.here(sel.live.count, sel.live.lastVerifiedAt ? timeAgo(sel.live.lastVerifiedAt, now) : null)}{sel.live.count > 0 && sel.live.shared && sel.i.provider ? ` ${d.shared(sel.i.provider)}` : ""}</dd>
                </div>
              )}
              {sel.v?.label && sel.v.scenarios && <div><dt className="text-faint">{d.exercised}</dt><dd className="mt-1 text-pretty">{sel.v.label}</dd></div>}
              {sel.i.connect && <div><dt className="text-faint">{d.lastTest}</dt><dd className="mt-1">{day(sel.v?.verifiedAt ?? sel.v?.previouslyVerifiedAt) ?? d.never}</dd></div>}
              {sel.v?.scenarios && (
                <div>
                  <dt className="sr-only">{d.verification}</dt>
                  <dd>
                    <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                      {SCENARIOS.map((s) => {
                        const r = sel.v?.scenarios?.find((x) => x.scenario === s);
                        const ok = r?.verdict === "PASS";
                        return (
                          <li key={s} className="flex items-center gap-1.5">
                            {ok ? <CheckIcon aria-hidden className="size-3.5 text-primary" /> : <XIcon aria-hidden className="size-3.5 text-clay" />}
                            <span>{d.scenarios[s]}</span>
                            <span className="sr-only">: {r ? d.verdict[r.verdict] : d.notRun}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </dd>
                </div>
              )}
              {sel.shown === "blocked" && sel.v?.missing?.length ? (
                <div><dt className="text-faint">{d.needs}</dt><dd className="mt-1"><ul className="grid gap-1">{sel.v.missing.map((m) => <li key={m} className="text-pretty">{m}</li>)}</ul></dd></div>
              ) : null}
              {sel.i.connect && <p className="font-mono text-caption text-faint">{d.rerun}</p>}
            </dl>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" className="h-10 rounded-full border-border px-5 text-small" onClick={() => setOpen(null)}>{d.close}</Button>
              {sel.i.connect && canAct && (
                <Button asChild className="h-10 rounded-full px-5 text-small"><Link href={`/connect?provider=${sel.i.id}`}>{d.connect}</Link></Button>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>

      {canAct && <SampleAgent />}
    </Page>
  );
}
