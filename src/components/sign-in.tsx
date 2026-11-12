"use client";

import Link from "next/link";
import { useState } from "react";
import { LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n/error-text";
import { useStore } from "@/lib/store";

/** Sign-in. With accounts on it points to e-mail sign-in; `token` (the admin's page) shows the admin-token form, which is exchanged for an HttpOnly cookie and not kept by the page. */
export function SignIn({ compact, token: tokenOnly }: { compact?: boolean; token?: boolean }) {
  const t = useT();
  const viewer = useStore((s) => s.viewer);
  const signIn = useStore((s) => s.signIn);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [withToken, setWithToken] = useState(!!tokenOnly);

  // With accounts on, people sign in with their e-mail address; the admin token stays one click away.
  if (viewer?.accounts && !withToken)
    return (
      <div className={compact ? "grid gap-3" : "mx-auto grid max-w-sm gap-4 py-16"}>
        <div>
          {!compact && <LockIcon className="mb-5 size-5 text-faint" strokeWidth={1.5} />}
          <h1 className={compact ? "text-title" : "text-h2"}>{t.account.prompt.title}</h1>
          <p className="mt-2 text-small text-pretty text-muted-foreground">{viewer.approval === false ? (viewer.emailVerification === false ? t.account.prompt.bodyInstant : t.account.prompt.bodyOpen) : t.account.prompt.body}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="h-11 rounded-full px-6 text-ui"><Link href="/account/sign-in">{t.account.prompt.signIn}</Link></Button>
          <Button asChild variant="secondary" className="h-11 rounded-full border-border px-6 text-ui"><Link href="/account/sign-up">{t.account.prompt.create}</Link></Button>
        </div>
        {viewer.operatorAvailable && <button type="button" onClick={() => setWithToken(true)} className="justify-self-start text-caption text-faint hover:text-foreground">{t.account.prompt.token}</button>}
      </div>
    );

  if (viewer && !viewer.operatorAvailable)
    return <p className="text-small text-muted-foreground">{t.signIn.notConfigured[0]} <code className="font-mono text-meta">TEND_ADMIN_TOKEN</code>{t.signIn.notConfigured[1]}</p>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await signIn(token);
    setBusy(false);
    if (!r.ok) setError(errorText(t, r));
    else setToken("");
  };

  return (
    <form onSubmit={submit} className={compact ? "grid gap-3" : "mx-auto grid max-w-sm gap-4 py-16"}>
      {!compact && (
        <div>
          <LockIcon className="mb-5 size-5 text-faint" strokeWidth={1.5} />
          <h1 className="text-h2">{t.signIn.title}</h1>
          <p className="mt-2 text-small text-muted-foreground">{viewer?.public ? t.signIn.bodyPublic : t.signIn.bodyPrivate} {t.signIn.enterToken}</p>
        </div>
      )}
      <Input type="password" autoComplete="current-password" className={compact ? "h-11 rounded-xl text-ui" : undefined} value={token} onChange={(e) => setToken(e.target.value)} placeholder={t.signIn.placeholder} aria-label={t.signIn.placeholder} aria-invalid={!!error} required />
      {error && <p role="alert" className="text-small text-destructive">{error}</p>}
      <Button type="submit" disabled={busy || !token} className={compact ? "h-11 rounded-full text-ui" : undefined}>{busy ? t.signIn.signingIn : t.signIn.submit}</Button>
    </form>
  );
}
