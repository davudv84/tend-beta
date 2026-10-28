"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, CopyIcon, KeyRoundIcon, PlugIcon } from "lucide-react";
import { Gated, useReadOnlyReason } from "@/components/agent-callout";
import { AgentAvatar, agentState, Dot, Empty } from "@/components/kit";
import {
  AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n";
import { timeAgo, useNow } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Provider } from "@/lib/types";

const PROVIDERS: Provider[] = ["Anthropic", "OpenAI", "Google", "Custom"];

/** Registering, inspecting and re-keying connected agents. Keys are shown exactly once. */
export function ConnectedAgents() {
  const t = useT();
  const c = t.connected;
  const all = useStore((s) => s.agents);
  const agents = useMemo(() => all.filter((a) => a.origin === "connected"), [all]);
  const keys = useStore((s) => s.keys);
  const skew = useStore((s) => s.skew);
  const canAct = useStore((s) => !!s.viewer?.canAct);
  const registerAgent = useStore((s) => s.registerAgent);
  const rotateKey = useStore((s) => s.rotateKey);
  const readOnly = useReadOnlyReason();
  const now = useNow() + skew;
  const [form, setForm] = useState({ name: "", model: "", provider: "Anthropic" as Provider, role: "", public: false });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [reveal, setReveal] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await registerAgent({ ...form, name: form.name.trim(), model: form.model.trim(), role: form.role.trim() || undefined });
    setBusy(false);
    if (!r.ok) return setErrors(r.errors?.length ? r.errors : [errorText(t, r)]);
    setErrors([]);
    setReveal({ name: form.name.trim(), key: r.apiKey });
    setForm({ name: "", model: "", provider: "Anthropic", role: "", public: false });
  };

  const rotate = async (id: string, name: string) => {
    const r = await rotateKey(id);
    if (!r.ok) return toast.error(c.rotateFailed, { description: errorText(t, r) });
    setReveal({ name, key: r.apiKey });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reveal?.key ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(c.clipboard);
    }
  };

  return (
    <div className="grid gap-10">
      <section>
        <div className="frame overflow-hidden">
          {agents.length ? (
            <ul className="divide-y divide-border">
              {agents.map((a) => {
                const s = agentState(a, now);
                const syncing = a.ackedVersion < a.configVersion;
                return (
                  <li key={a.id} className="grid gap-x-6 gap-y-2 px-2 py-4 md:grid-cols-[minmax(0,1.4fr)_9rem_10rem_minmax(0,1fr)_auto] md:items-center md:px-3">
                    <Link href={`/agents/${a.id}`} className="flex min-w-0 items-center gap-3">
                      <AgentAvatar agent={a} size="sm" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium hover:underline">{a.name}</span>
                        <span className="block truncate text-caption text-faint">{a.model} · {a.provider}{a.public ? c.public : ""}</span>
                      </span>
                    </Link>
                    <span className="flex items-center gap-2 text-small text-muted-foreground"><Dot tone={s.tone} />{t.state.label[s.key]}</span>
                    <span className="font-mono text-meta text-faint">{a.lastSeenAt ? c.heard(timeAgo(a.lastSeenAt, now)) : c.never}</span>
                    <span className="font-mono text-meta">
                      <span className="text-faint">{keys[a.id] ?? "tend_sk_"}… </span>
                      <span className={syncing ? "text-amber" : "text-faint"}>{c.config(a.configVersion, syncing)}</span>
                    </span>
                    <Gated allowed={canAct} reason={readOnly}>
                      <Button variant="ghost" size="sm" disabled={!canAct} onClick={() => rotate(a.id, a.name)} className="text-muted-foreground"><KeyRoundIcon /> {c.rotate}</Button>
                    </Gated>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty icon={PlugIcon} title={c.emptyTitle} body={c.emptyBody} />
          )}
        </div>
      </section>

      <section className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          <h2 className="text-title">{c.registerTitle}</h2>
          {canAct && <Button asChild variant="outline" size="sm" className="mt-3"><Link href="/connect">{c.guided}</Link></Button>}
          <p className="mt-2 text-small text-muted-foreground">
            {c.registerBody[0]} <Link href="/developers" className="underline underline-offset-2 hover:text-foreground">{t.nav.items.developers.label}</Link>{c.registerBody[1]}
          </p>
        </div>
        {canAct ? (
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2"><Label htmlFor="ag-name">{c.name}</Label><Input id="ag-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} required /></div>
            <div className="grid gap-2"><Label htmlFor="ag-model">{c.model}</Label><Input id="ag-model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} maxLength={60} placeholder={c.modelPlaceholder} required /></div>
            <div className="grid gap-2">
              <Label>{c.provider}</Label>
              <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v as Provider })}>
                <SelectTrigger className="h-9! w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{PROVIDERS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2"><Label htmlFor="ag-role">{c.role} <span className="font-normal text-faint">· {t.common.optional}</span></Label><Input id="ag-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} maxLength={60} /></div>
            <label className="flex items-center gap-2.5 text-small text-muted-foreground sm:col-span-2">
              <input type="checkbox" checked={form.public} onChange={(e) => setForm({ ...form, public: e.target.checked })} className="accent-[var(--sage)]" />
              {c.publicCheck}
            </label>
            {errors.length > 0 && <ul role="alert" className="text-small text-destructive sm:col-span-2">{errors.map((x) => <li key={x}>{x}</li>)}</ul>}
            <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? c.registering : c.register}</Button></div>
          </form>
        ) : (
          <p className="text-small text-faint">{readOnly}</p>
        )}
      </section>

      <AlertDialog open={!!reveal} onOpenChange={(o) => !o && (setReveal(null), setCopied(false))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{c.keyTitle(reveal?.name ?? "")}</AlertDialogTitle>
            <AlertDialogDescription>{c.keyBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 border border-border bg-background px-3 py-2">
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-small whitespace-nowrap select-all">{reveal?.key}</code>
            <Button variant="ghost" size="icon-sm" onClick={copy} aria-label={c.copyKey}>{copied ? <CheckIcon className="text-sage" /> : <CopyIcon />}</Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogAction>{c.stored}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
