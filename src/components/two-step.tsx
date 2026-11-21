"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n/error-text";
import { call } from "@/lib/store";
import { CardHeader, buttonClass } from "@/ui/primitives";

type Status = { enabled: boolean; available: boolean; recoveryCodesLeft?: number };
const input = "h-10 w-full max-w-xs rounded-md border border-border bg-background px-3 text-[14px]";

/** Two-step sign-in (TOTP) for the signed-in account: set up, turn on with a first code, turn off with password and code. */
export function TwoStep() {
  const t = useT();
  const g = t.settingsPage.twoStep;
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const load = () => setRound((n) => n + 1);
  useEffect(() => {
    let live = true;
    void call<Status>("/api/account/mfa", undefined, "GET").then((r) => { if (live && r.ok) setStatus(r.data); });
    return () => { live = false; };
  }, [round]);
  const act = async (body: Record<string, string>) => {
    setBusy(true); setError(null);
    const r = await call<{ secret?: string; uri?: string; recoveryCodes?: string[] }>("/api/account/mfa", body);
    setBusy(false);
    if (!r.ok) { setError(errorText(t, r)); return undefined; }
    setCode(""); setPassword("");
    return r.data;
  };
  if (!status) return null;
  return (
    <div className="border-t border-border">
      <CardHeader title={g.title} sub={g.sub} />
      <div className="grid gap-3 px-6 pb-6 text-[14px]">
        {!status.available ? <p className="text-muted-foreground">{g.adminToken}</p> : status.enabled ? (
          <>
            <p><span className="font-medium">{g.on}.</span> {g.left(status.recoveryCodesLeft ?? 0)}</p>
            {codes && <Codes codes={codes} text={g.recovery} />}
            <p className="text-muted-foreground">{g.disableHint}</p>
            <input className={input} type="password" autoComplete="current-password" placeholder={g.password} value={password} onChange={(e) => setPassword(e.target.value)} />
            <input className={input} autoComplete="one-time-code" placeholder={g.code} value={code} onChange={(e) => setCode(e.target.value)} />
            <div><button type="button" disabled={busy || !password || !code} className={buttonClass("secondary")} onClick={async () => { if (await act({ action: "disable", password, code })) { setCodes(null); load(); } }}>{g.disable}</button></div>
          </>
        ) : setup ? (
          <>
            <p>{g.step1}</p>
            <code className="w-fit rounded-md border border-border bg-background px-3 py-2 font-mono text-[13px] tracking-wider select-all">{setup.secret}</code>
            <a href={setup.uri} className="w-fit font-medium text-primary hover:underline">{g.openLink}</a>
            <p>{g.step2}</p>
            <input className={input} inputMode="numeric" autoComplete="one-time-code" placeholder={g.code} value={code} onChange={(e) => setCode(e.target.value)} />
            <input className={input} type="password" autoComplete="current-password" placeholder={g.password} value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="flex gap-2">
              <button type="button" disabled={busy || code.length !== 6 || !password} className={buttonClass("primary")} onClick={async () => { const d = await act({ action: "enable", code, password }); if (d?.recoveryCodes) { setCodes(d.recoveryCodes); setSetup(null); load(); } }}>{g.enable}</button>
              <button type="button" className={buttonClass("secondary")} onClick={() => setSetup(null)}>{g.cancel}</button>
            </div>
          </>
        ) : (
          <>
            <p><span className="font-medium">{g.off}.</span></p>
            <input className={input} type="password" autoComplete="current-password" placeholder={g.password} value={password} onChange={(e) => setPassword(e.target.value)} />
            <div><button type="button" disabled={busy || !password} className={buttonClass("secondary")} onClick={async () => { const d = await act({ action: "setup", password }); if (d?.secret && d.uri) setSetup({ secret: d.secret, uri: d.uri }); }}>{g.start}</button></div>
          </>
        )}
        {error && <p role="alert" className="text-[#b42318]">{error}</p>}
      </div>
    </div>
  );
}

function Codes({ codes, text }: { codes: string[]; text: string }) {
  return (
    <div role="status" className="rounded-md border border-border bg-[#eef6f2] px-4 py-3 dark:bg-[rgb(141_187_165/0.14)]">
      <p className="text-[13px]">{text}</p>
      <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-[13px] select-all">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
    </div>
  );
}
