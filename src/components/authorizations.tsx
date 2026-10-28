"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, KeyRoundIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { useReadOnlyReason } from "@/components/agent-callout";
import { AgentAvatar, Dot, Empty, type Tone } from "@/components/kit";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n";
import { dateTime, duration, timeAgo } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Agent, Authorization, AuthorizationStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUSES: AuthorizationStatus[] = ["pending", "approved", "consumed", "rejected", "denied", "expired", "cancelled"];
const TONE: Record<AuthorizationStatus, Tone> = { pending: "amber", approved: "sage", consumed: "white", rejected: "muted", denied: "muted", expired: "muted", cancelled: "muted" };
const BADGE: Record<AuthorizationStatus, string> = {
  pending: "bg-amber/10 text-amber",
  approved: "bg-sage/10 text-sage",
  consumed: "bg-elevated text-foreground",
  rejected: "bg-elevated text-muted-foreground",
  denied: "bg-elevated text-muted-foreground",
  expired: "bg-elevated text-muted-foreground",
  cancelled: "bg-elevated text-muted-foreground",
};
const PAGE = 30;

/** Pending or approved past its deadline reads as expired at once; the server closes it on its next sweep and refuses it either way. */
export const shownStatus = (a: Authorization, now: number): AuthorizationStatus =>
  (a.status === "pending" || a.status === "approved") && a.expiresAt !== undefined && a.expiresAt <= now ? "expired" : a.status;

function StatusBadge({ status }: { status: AuthorizationStatus }) {
  const t = useT();
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-meta font-medium whitespace-nowrap", BADGE[status])}>{t.authz.status[status]}</span>;
}

const what = (a: Authorization) => [a.tool, a.action, a.resource].filter(Boolean).join(" · ");

/** Approve or reject one pending authorization. Nothing is reported as done until the server confirms it. */
function Decide({ auth, agent }: { auth: Authorization; agent: Agent }) {
  const t = useT();
  const z = t.authz;
  const decide = useStore((s) => s.decide);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const readOnly = useReadOnlyReason();
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!canAct) return <p className="text-small text-faint">{readOnly}</p>;

  const act = async (status: "approved" | "rejected") => {
    setBusy(true);
    const r = await decide(auth.id, status, note.trim() || undefined);
    setBusy(false);
    if (!r.ok) return toast.error(z.notRecorded, { description: errorText(t, r) });
    if (status === "approved") toast.success(z.approved, { description: z.approvedNote });
    else toast.success(z.rejected);
  };

  return (
    <div className="grid gap-3">
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.reviewUi.notePlaceholder} className="min-h-16 resize-none bg-background/60 text-sm" maxLength={500} aria-label={t.reviewUi.noteLabel} />
      <div className="flex flex-wrap gap-2">
        <Button size="lg" disabled={busy} onClick={() => setConfirm(true)}><CheckIcon /> {z.approve}</Button>
        <Button size="lg" disabled={busy} variant="outline" onClick={() => act("rejected")}><XIcon /> {z.reject}</Button>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{z.confirmTitle(agent.name)}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid gap-3">
                <span className="block rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-caption break-all text-foreground">
                  {what(auth)}{auth.detail && <span className="mt-1 block font-sans text-sm">{auth.detail}</span>}
                </span>
                <span className="block">{z.confirmBody}</span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => act("approved")}>{z.approve}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** A request waiting for a human: everything that will be bound to the token, and the decision. */
function PendingCard({ auth, agent, now }: { auth: Authorization; agent: Agent; now: number }) {
  const t = useT();
  const z = t.authz;
  return (
    <article className="min-w-0 frame">
      <header className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <AgentAvatar agent={agent} size="sm" />
        <p className="min-w-0 flex-1 truncate text-sm">
          <Link href={`/agents/${agent.id}`} className="font-medium hover:underline">{agent.name}</Link>{" "}
          <span className="text-muted-foreground">{t.say.log.authorization_requested({ name: agent.name, tool: auth.tool, action: auth.action })}</span>
        </p>
        <StatusBadge status="pending" />
        <time className="hidden font-mono text-xs text-faint sm:block" title={dateTime(auth.createdAt)}>{timeAgo(auth.createdAt, now)}</time>
      </header>
      <div className="grid gap-5 p-5 md:grid-cols-[1fr_minmax(0,22rem)]">
        <div className="grid min-w-0 content-start gap-4">
          <p className="font-mono text-sm break-all">{auth.tool} · {auth.action}</p>
          {auth.resource && (
            <div>
              <p className="text-small text-faint">{z.resource}</p>
              <p className="mt-1 font-mono text-sm break-all">{auth.resource}</p>
            </div>
          )}
          <div className="rounded-lg border border-amber/30 bg-amber/5 p-4">
            <p className="eyebrow">{z.detail}</p>
            <p className="mt-2 text-sm leading-relaxed break-words">{auth.detail ?? <span className="text-faint">{z.noDetail}</span>}</p>
          </div>
          <p className="font-mono text-meta text-faint">
            {z.policy}: {z.reasons[auth.reason ?? ""] ?? auth.reason}
            {auth.expiresAt && <> · {z.expiresIn(duration(now, auth.expiresAt))}</>}
          </p>
        </div>
        <Decide auth={auth} agent={agent} />
      </div>
    </article>
  );
}

function Row({ auth, agent, status, now }: { auth: Authorization; agent?: Agent; status: AuthorizationStatus; now: number }) {
  const t = useT();
  const z = t.authz;
  const reason = auth.reason && !["policy_allowed", "approval_required"].includes(auth.reason) ? z.reasons[auth.reason] ?? auth.reason : undefined;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1.5 px-5 py-3.5 md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto_5.5rem]">
      <span className="col-span-2 flex min-w-0 items-center gap-2.5 md:col-span-1">
        {agent && <AgentAvatar agent={agent} size="sm" />}
        <span className="truncate text-sm font-medium">{agent?.name ?? auth.agentId}</span>
      </span>
      <span className="min-w-0">
        <span className="block font-mono text-caption break-all">{what(auth)}</span>
        {(auth.detail || reason || auth.note) && (
          <span className="mt-0.5 block text-small text-faint">
            {[auth.detail, reason, auth.note && t.quote(auth.note)].filter(Boolean).join(" · ")}
          </span>
        )}
        {status === "approved" && auth.expiresAt && <span className="mt-0.5 block font-mono text-meta text-sage">{z.usableFor(duration(now, auth.expiresAt))}</span>}
      </span>
      <span className="flex items-center gap-1.5 justify-self-end">
        {auth.alerts > 0 && (
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-amber/10 px-2 text-meta font-medium text-amber"><ShieldAlertIcon className="size-3" />{z.alerts(auth.alerts)}</span>
        )}
        <StatusBadge status={status} />
      </span>
      <time className="hidden text-right font-mono text-xs whitespace-nowrap text-faint tabular-nums md:block" title={dateTime(auth.createdAt)}>{timeAgo(auth.createdAt, now)}</time>
    </li>
  );
}

/** Every authorization this viewer may see, newest first: the ones waiting for a human on top, with controls. */
export function Authorizations({ now }: { now: number }) {
  const t = useT();
  const z = t.authz;
  const all = useStore((s) => s.authorizations);
  const agents = useStore((s) => s.agents);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const [filter, setFilter] = useState<AuthorizationStatus | "all">("all");
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => all.map((a) => ({ a, status: shownStatus(a, now) })), [all, now]);
  const counts = useMemo(() => {
    const m = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<AuthorizationStatus, number>;
    for (const r of rows) m[r.status]++;
    return m;
  }, [rows]);
  const pending = rows.filter((r) => r.status === "pending" && byId.has(r.a.agentId) && (filter === "all" || filter === "pending"));
  const rest = rows.filter((r) => r.status !== "pending" && (filter === "all" || r.status === filter));

  if (!all.length) return <div className="frame"><Empty icon={KeyRoundIcon} title={z.emptyTitle} body={z.emptyBody} /></div>;

  const chip = (on: boolean) => cn("inline-flex h-7 items-center gap-2 rounded-full border px-3 text-small transition-colors",
    on ? "border-foreground/15 bg-elevated text-foreground" : "border-border text-muted-foreground hover:text-foreground");
  return (
    <div className="grid gap-4">
      <p className="max-w-3xl text-small leading-relaxed text-muted-foreground">{z.intro}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={z.filter}>
        <button type="button" aria-pressed={filter === "all"} onClick={() => { setFilter("all"); setLimit(PAGE); }} className={chip(filter === "all")}>
          {z.all} <span className="font-mono text-meta text-faint">{rows.length}</span>
        </button>
        {STATUSES.map((s) => (
          <button key={s} type="button" aria-pressed={filter === s} disabled={!counts[s] && filter !== s} onClick={() => { setFilter(s); setLimit(PAGE); }}
            className={cn(chip(filter === s), "disabled:pointer-events-none disabled:opacity-40")}>
            <Dot tone={TONE[s]} />{z.status[s]}<span className="font-mono text-meta text-faint">{counts[s]}</span>
          </button>
        ))}
      </div>

      {pending.map(({ a }) => <PendingCard key={a.id} auth={a} agent={byId.get(a.agentId)!} now={now} />)}

      {rest.length > 0 && (
        <div className="frame overflow-hidden">
          <ul className="divide-y divide-border">
            {rest.slice(0, limit).map(({ a, status }) => <Row key={a.id} auth={a} agent={byId.get(a.agentId)} status={status} now={now} />)}
          </ul>
          {rest.length > limit && (
            <div className="border-t border-border p-3">
              <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setLimit((n) => n + PAGE)}>{z.more}</Button>
            </div>
          )}
        </div>
      )}
      {!pending.length && !rest.length && <div className="frame"><Empty icon={KeyRoundIcon} title={z.emptyFilter} /></div>}
      {(filter === "all" || filter === "consumed") && counts.consumed > 0 && <p className="text-caption text-faint">{z.usedNote}</p>}
    </div>
  );
}
