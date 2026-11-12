"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SignIn } from "@/components/sign-in";
import { Button } from "@/components/ui/button";
import { errorText } from "@/i18n/error-text";
import { useT } from "@/i18n/client";
import { shortDate } from "@/lib/format";
import { call, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Page, PageSkeleton } from "@/ui/page";

interface User { id: string; email: string; createdAt: number; verifiedAt: number | null; approvedAt: number | null; disabledAt: number | null; agents: number }
type State = "unverified" | "pending" | "approved" | "disabled";
const stateOf = (u: User): State => (u.disabledAt ? "disabled" : !u.verifiedAt ? "unverified" : !u.approvedAt ? "pending" : "approved");
const ORDER: State[] = ["pending", "unverified", "approved", "disabled"];
const BADGE: Record<State, string> = {
  pending: "border-primary/25 bg-primary/[0.07] text-primary",
  unverified: "border-border text-muted-foreground",
  approved: "border-border text-foreground",
  disabled: "border-dashed border-border text-faint",
};

/** Beta access: who signed up, and approving or disabling them. The admin-token session only; the server checks it on every call. */
export default function View() {
  const t = useT();
  const a = t.account.admin;
  const ready = useStore((s) => s.ready);
  const status = useStore((s) => s.status);
  const admin = useStore((s) => !!s.viewer?.admin);
  const [users, setUsers] = useState<User[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await call<{ users: User[] }>("/api/admin/users", undefined, "GET");
    if (r.ok) setUsers(r.data.users);
    else toast.error(a.failed, { description: errorText(t, r) });
  }, [a.failed, t]);
  useEffect(() => {
    if (!admin) return;
    let live = true;
    void call<{ users: User[] }>("/api/admin/users", undefined, "GET").then((r) => live && r.ok && setUsers(r.data.users));
    return () => void (live = false);
  }, [admin]);

  if (status === "signin") return <Page><SignIn compact /></Page>;
  if (!ready) return <PageSkeleton label={t.home.loading} />;
  if (!admin) return <Page><p className="text-body text-muted-foreground">{a.only}</p></Page>;

  const act = async (u: User, action: "approve" | "disable" | "enable") => {
    setBusy(u.id);
    const r = await call(`/api/admin/users/${encodeURIComponent(u.id)}`, { action });
    setBusy(null);
    if (!r.ok) toast.error(a.failed, { description: errorText(t, r) });
    await load();
  };
  const sorted = [...(users ?? [])].sort((x, y) => ORDER.indexOf(stateOf(x)) - ORDER.indexOf(stateOf(y)) || y.createdAt - x.createdAt);

  return (
    <Page>
      <header>
        <h1 className="text-section text-balance">{a.title}</h1>
        <p className="mt-4 max-w-[60ch] text-lead text-pretty text-muted-foreground">{a.description}</p>
      </header>
      {users === null ? <p className="mt-10 text-small text-muted-foreground">{t.home.loading}</p> : sorted.length === 0 ? (
        <p className="mt-10 rounded-xl border border-dashed border-border px-6 py-12 text-center text-body text-muted-foreground">{a.none}</p>
      ) : (
        <ul className="mt-8 divide-y divide-border rounded-xl border border-border">
          {sorted.map((u) => {
            const s = stateOf(u);
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui font-medium">{u.email}</p>
                  <p className="text-caption text-faint">{a.created} {shortDate(u.createdAt)} · {a.agents}: {u.agents}</p>
                </div>
                <span className={cn("rounded-full border px-2 py-0.5 text-caption whitespace-nowrap", BADGE[s])}>{a.states[s]}</span>
                <div className="flex gap-2">
                  {s === "pending" && <Button disabled={busy === u.id} onClick={() => void act(u, "approve")} className="h-9 rounded-full px-4 text-small">{a.approve}</Button>}
                  {s === "disabled" ? <Button variant="secondary" disabled={busy === u.id} onClick={() => void act(u, "enable")} className="h-9 rounded-full border-border px-4 text-small">{a.enable}</Button>
                    : <Button variant="secondary" disabled={busy === u.id} onClick={() => void act(u, "disable")} className="h-9 rounded-full border-border px-4 text-small">{a.disable}</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
