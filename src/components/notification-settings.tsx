"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BellIcon, BellOffIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useLocale, useT } from "@/i18n/client";
import { errorText } from "@/i18n";
import { disablePush, enablePush, permissionState, pushSupport, thisBrowserSubscribed, useNotifications, type EnableResult } from "@/lib/notifications";
import { call } from "@/lib/store";
import { Badge, Card, CardHeader, buttonClass, type Tone } from "@/ui/primitives";

export type PushStatus = "checking" | "on" | "off" | "denied" | "unsupported" | "insecure" | "notConfigured" | "account";
const TONE: Record<PushStatus, Tone> = { checking: "neutral", on: "good", off: "neutral", denied: "attention", unsupported: "neutral", insecure: "neutral", notConfigured: "attention", account: "neutral" };

/**
 * Where browser notifications stand for this browser, from the server (configured? an account?) and the browser (supported? permitted?
 * subscribed, as the server confirms). `enable` must be called from a click: it is the only place permission is ever requested.
 */
export function usePushState() {
  const t = useT();
  const { locale } = useLocale();
  const push = useNotifications((s) => s.push);
  const [busy, setBusy] = useState(false);
  const [subscribed, setSubscribed] = useState<{ v: boolean; at: number } | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => { if (!push) void useNotifications.getState().refresh(); }, [push]);
  // Everything that can be known at once is worked out while rendering; only "is this browser subscribed?" needs the server.
  const support = push ? pushSupport() : null;
  const known: PushStatus | null = !push ? "checking" : !push.account ? "account" : !push.configured ? "notConfigured"
    : support !== "supported" ? support : permissionState() === "denied" ? "denied" : null;
  useEffect(() => {
    if (known !== null) return;
    let live = true;
    void thisBrowserSubscribed().then((v) => { if (live) setSubscribed({ v, at: round }); });
    return () => { live = false; };
  }, [known, round]);
  const status: PushStatus = known ?? (subscribed?.at !== round ? "checking" : subscribed.v ? "on" : "off");
  const check = () => setRound((n) => n + 1);

  const enable = async (): Promise<EnableResult> => {
    setBusy(true);
    const r = await enablePush(push?.publicKey ?? null, locale);
    setBusy(false);
    if (r.ok) toast.success(t.notify.prefs.enabled);
    else if (r.reason === "dismissed") toast(t.notify.prefs.dismissed);
    else if (r.reason === "failed") toast.error(t.notify.prefs.enableFailed, { description: r.code ? errorText(t, { error: r.error ?? "", code: r.code }) : r.error });
    await useNotifications.getState().refresh();
    check();
    return r;
  };
  const disable = async () => {
    setBusy(true);
    const ok = await disablePush();
    setBusy(false);
    if (ok) toast.success(t.notify.prefs.disabled); else toast.error(t.notify.prefs.disableFailed);
    await useNotifications.getState().refresh();
    check();
  };
  return { status, busy, enable, disable };
}

export function PushStatusLine({ status }: { status: PushStatus }) {
  const t = useT();
  return (
    <div className="grid gap-1.5">
      <Badge tone={TONE[status]} className="justify-self-start">{t.notify.prefs.status[status]}</Badge>
      <p className="max-w-[60ch] text-[14px] text-pretty text-muted-foreground">{t.notify.prefs.note[status]}</p>
    </div>
  );
}

type Prefs = { approval: boolean; blocked: boolean; alert: boolean };

/** Settings → Notifications: this browser, which kinds go to the browser, and a test. */
export function NotificationSettings() {
  const t = useT();
  const p = t.notify.prefs;
  const { status, busy, enable, disable } = usePushState();
  const account = useNotifications((s) => s.push?.account);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!account) return;
    let live = true;
    void call<Prefs>("/api/v1/notifications/preferences", undefined, "GET").then((r) => { if (live && r.ok) setPrefs(r.data); });
    return () => { live = false; };
  }, [account]);

  const toggle = async (k: keyof Prefs, v: boolean) => {
    const r = await call<Prefs>("/api/v1/notifications/preferences", { [k]: v });
    if (!r.ok) return toast.error(p.saveFailed, { description: errorText(t, r) });
    setPrefs(r.data); // what the server stored, not what was clicked
  };
  const sendTest = async () => {
    setTesting(true);
    const r = await call<{ push: { configured: boolean; sent: number } }>("/api/v1/notifications/test");
    setTesting(false);
    await useNotifications.getState().refresh();
    if (!r.ok) return toast.error(p.testFailed, { description: errorText(t, r) });
    toast.success(r.data.push.configured ? p.testDone(r.data.push.sent) : p.testNoPush);
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={p.browserTitle} sub={p.sub} />
        <div className="grid gap-5 border-t border-border px-6 py-5">
          <PushStatusLine status={status} />
          <div className="flex flex-wrap gap-2.5">
            {status === "on" ? (
              <button type="button" disabled={busy} onClick={() => void disable()} className={buttonClass("secondary")}><BellOffIcon className="size-4" aria-hidden />{p.disable}</button>
            ) : (
              <button type="button" disabled={busy || status !== "off"} onClick={() => void enable()} className={buttonClass()}><BellIcon className="size-4" aria-hidden />{busy ? p.enabling : p.enable}</button>
            )}
            <button type="button" disabled={testing} onClick={() => void sendTest()} className={buttonClass("secondary")}>{testing ? p.testing : p.test}</button>
          </div>
        </div>
        <p className="border-t border-border px-6 py-4 text-[13px] text-pretty text-muted-foreground">{p.privacy}</p>
      </Card>
      {account && (
        <Card>
          <CardHeader title={p.kindsTitle} sub={p.kindsNote} />
          <ul className="divide-y divide-border border-t border-border">
            {(["approval", "blocked", "alert"] as const).map((k) => (
              <li key={k} className="flex items-center justify-between gap-6 px-6 py-4">
                <span id={`np-${k}`} className="text-[14px]">{p.kinds[k]}</span>
                <Switch checked={prefs?.[k] ?? true} disabled={!prefs} onCheckedChange={(v) => void toggle(k, v)} aria-labelledby={`np-${k}`} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
