"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, CopyIcon } from "lucide-react";
import { SignIn } from "@/components/sign-in";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n";
import { realAssistants } from "@/lib/home";
import { useStore, type SessionOverview } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Page, PageSkeleton } from "@/ui/page";
import { Badge, Card, CardHeader, buttonClass } from "@/ui/primitives";
import { Preferences } from "@/ui/shell";

type Tab = "security" | "keys" | "account";

/** Only what the backend supports: security facts, per-agent keys, and the operator's own account and preferences. */
export default function View() {
  const t = useT();
  const g = t.settingsPage;
  const ready = useStore((s) => s.ready);
  const status = useStore((s) => s.status);
  const viewer = useStore((s) => s.viewer);
  const agents = useStore((s) => s.agents);
  const keys = useStore((s) => s.keys);
  const rotateKey = useStore((s) => s.rotateKey);
  const revokeKey = useStore((s) => s.revokeKey);
  const signOut = useStore((s) => s.signOut);
  const getSessions = useStore((s) => s.getSessions);
  const signOutEverywhere = useStore((s) => s.signOutEverywhere);
  const [overview, setOverview] = useState<SessionOverview | null>(null);
  const [tab, setTab] = useState<Tab>("security");
  const [fresh, setFresh] = useState<{ id: string; key: string; revoked?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const connected = useMemo(() => realAssistants(agents).filter((a) => a.origin === "connected"), [agents]);
  const operatorNow = !!viewer?.canAct;
  useEffect(() => {
    if (!operatorNow || tab !== "security") return;
    let live = true;
    void getSessions().then((r) => { if (live && r.ok) setOverview(r.data); });
    return () => { live = false; };
  }, [operatorNow, tab, getSessions]);
  if (status === "signin") return <Page><SignIn compact /></Page>;
  if (!ready) return <PageSkeleton label={t.home.loading} />;
  const operator = !!viewer?.canAct;

  const rotate = async (id: string) => {
    setBusy(id);
    const r = await rotateKey(id);
    setBusy(null);
    if (!r.ok) return toast.error(g.keyFailed, { description: errorText(t, r) });
    setFresh({ id, key: r.apiKey });
    setCopied(false);
  };
  const revoke = async (id: string) => {
    setBusy(id);
    const r = await revokeKey(id);
    setBusy(null);
    if (!r.ok) return toast.error(g.keyFailed, { description: errorText(t, r) });
    setFresh({ id, key: "", revoked: true });
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { toast.error(t.connect.s3.copyFailed); } };
  const tabs: [Tab, string][] = [["security", g.tabs.security], ["keys", g.tabs.keys], ["account", g.tabs.account]];
  const fact = (label: string, value: React.ReactNode) => <div className="flex items-start justify-between gap-6 border-t border-border px-6 py-4 first:border-t-0"><dt className="text-[14px] text-muted-foreground">{label}</dt><dd className="text-right text-[14px] font-medium">{value}</dd></div>;

  return (
    <Page full>
      <h1 className="text-[40px] leading-[1.1] font-semibold tracking-[-0.03em]">{g.title}</h1>
      <p className="mt-3 text-[15px] text-muted-foreground">{g.sub}</p>
      <div className="mt-8 grid items-start gap-8 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label={g.title} className="flex gap-1 overflow-x-auto md:grid">
          {tabs.map(([k, label]) => <button key={k} type="button" aria-current={tab === k ? "true" : undefined} onClick={() => setTab(k)} className={cn("rounded-lg border px-3 py-2 text-left text-[14px] whitespace-nowrap transition-colors", tab === k ? "border-border bg-background font-medium text-primary" : "border-transparent text-muted-foreground hover:bg-sunken hover:text-foreground")}>{label}</button>)}
        </nav>

        {tab === "security" && (
          <Card>
            <CardHeader title={g.tabs.security} sub={g.securitySub} />
            <dl className="border-t border-border">
              {fact(g.adminToken, viewer?.operatorAvailable ? <Badge tone="good">{g.configured}</Badge> : <Badge tone="attention">{g.notConfigured}</Badge>)}
              {fact(g.signedInAs, operator ? t.ui.operator : t.ui.visitor)}
              {fact(g.session, g.sessionValue)}
              {fact(g.requestExpiry, g.expiryValue)}
              {fact(g.visitors, viewer?.public ? g.visitorsPublic : g.visitorsPrivate)}
              {fact(g.scope, g.scopeValue)}
            </dl>
          </Card>
        )}

        {tab === "security" && operator && (
          <div className="grid gap-6 md:col-start-2">
            <Card>
              <CardHeader title={g.sessionsTitle} sub={g.sessionsSub} />
              {!overview || overview.sessions.length === 0 ? <p className="border-t border-border px-6 py-5 text-[14px] text-muted-foreground">{g.noSessions}</p> : (
                <ul className="divide-y divide-border border-t border-border">
                  {overview.sessions.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 text-[14px]">
                      <div className="min-w-0">
                        <p className="font-medium">#{s.id.slice(0, 6)}</p>
                        <p className="text-[13px] text-muted-foreground">{g.startedAt(new Date(s.createdAt).toLocaleString(t.intl.date))} · {s.lastSeenAt ? g.lastActive(new Date(s.lastSeenAt).toLocaleString(t.intl.date)) : g.never} · {s.client && s.client !== "unknown" ? g.fromAddress(s.client) : g.addressUnknown}</p>
                      </div>
                      {s.current && <Badge tone="good">{g.thisBrowser}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-6 py-4">
                <p className="max-w-[52ch] text-[13px] text-muted-foreground">{g.signOutAllHint}</p>
                <button type="button" disabled={busy === "sessions"} onClick={async () => { setBusy("sessions"); const r = await signOutEverywhere(); setBusy(null); if (!r.ok) toast.error(g.signOutAllFailed, { description: errorText(t, r) }); }} className={buttonClass("secondary")}>{g.signOutAll}</button>
              </div>
            </Card>
            <Card>
              <CardHeader title={g.recentTitle} sub={g.recentSub} />
              {!overview || overview.recent.length === 0 ? <p className="border-t border-border px-6 py-5 text-[14px] text-muted-foreground">{g.noRecent}</p> : (
                <ul className="divide-y divide-border border-t border-border">
                  {overview.recent.slice(0, 12).map((e, i) => (
                    <li key={`${e.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-6 py-3 text-[14px]">
                      <span>{g.authEvents[e.type] ?? e.type}{e.reason && g.authReasons[e.reason] ? ` (${g.authReasons[e.reason]})` : ""}</span>
                      <span className="text-[13px] text-muted-foreground tabular-nums">{new Date(e.at).toLocaleString(t.intl.date)}{e.client && e.client !== "unknown" ? ` · ${e.client}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}

        {tab === "keys" && (
          <Card>
            <CardHeader title={g.tabs.keys} sub={g.keysSub} />
            {!operator ? <p className="border-t border-border px-6 py-5 text-[14px] text-muted-foreground">{t.tools.readOnly}</p> : (
              <>
                {fresh && (
                  <div role="status" className="border-t border-border bg-[#eef6f2] px-6 py-4">
                    {fresh.revoked ? <p className="text-[14px] text-[#176b50]">{g.revoked(connected.find((a) => a.id === fresh.id)?.name ?? "")}</p> : (
                      <>
                        <p className="text-[14px] font-medium text-[#176b50]">{g.newKey(connected.find((a) => a.id === fresh.id)?.name ?? "")}</p>
                        <div className="mt-2 flex items-center gap-3"><code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-[13px] whitespace-nowrap select-all">{fresh.key}</code>
                          <button type="button" onClick={() => void copy(fresh.key)} className={buttonClass("secondary")}>{copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}{copied ? t.connect.s3.copied : t.connect.s3.copyKey}</button></div>
                        <p className="mt-2 text-[13px] text-muted-foreground">{g.shownOnce}</p>
                      </>
                    )}
                  </div>
                )}
                {connected.length === 0 ? <p className="border-t border-border px-6 py-5 text-[14px] text-muted-foreground">{g.noAgents} <Link href="/connect" className="font-medium text-primary hover:underline">{t.ui.nav.integrations}</Link></p> : (
                  <ul className="divide-y divide-border border-t border-border">
                    {connected.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                        <div className="min-w-0"><p className="text-[15px] font-medium">{a.name}</p><p className="font-mono text-[13px] text-muted-foreground">{keys[a.id] ? `${keys[a.id]}…` : g.noKey}</p></div>
                        <div className="flex gap-2">
                          <button type="button" disabled={busy === a.id} onClick={() => void rotate(a.id)} className={buttonClass("secondary")}>{g.rotate}</button>
                          <button type="button" disabled={busy === a.id || !keys[a.id]} onClick={() => void revoke(a.id)} className={buttonClass("secondary")}>{g.revoke}</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="border-t border-border px-6 py-4 text-[13px] text-muted-foreground">{g.keysNote}</p>
              </>
            )}
          </Card>
        )}

        {tab === "account" && (
          <Card>
            <CardHeader title={g.tabs.account} sub={g.accountSub} />
            <div className="border-t border-border px-6 py-6"><Preferences /></div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border px-6 py-4 text-[14px]">
              <Link href="/labs" className="font-medium text-primary hover:underline">{t.ui.footer.labs}</Link>
              <Link href="/developers" className="font-medium text-primary hover:underline">{t.ui.footer.developers}</Link>
              {operator && <button type="button" onClick={() => void signOut()} className="ml-auto font-medium text-[#b42318] hover:underline">{t.ui.signOut}</button>}
            </div>
          </Card>
        )}
      </div>
    </Page>
  );
}
