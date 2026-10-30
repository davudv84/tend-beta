"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { CheckIcon, MailIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/i18n";
import { useT } from "@/i18n/client";
import { call, useStore } from "@/lib/store";

const MIN = 10; // accounts.ts PASSWORD.min
/** Seconds before another confirmation mail can be asked for. The server has its own limit (three mails per address an hour). */
const RESEND_COOLDOWN = 60;
/** Tells a sign-up page open in another tab of this browser that the address was just confirmed, so it continues at once. */
const ACCOUNT_CHANNEL = "tend-account";

/** The one-time token from a mail link. It is in the fragment (#token=…), so it never reaches a server log or a Referer header. */
function useLinkToken() {
  const hash = useSyncExternalStore(
    (cb) => (addEventListener("hashchange", cb), () => removeEventListener("hashchange", cb)),
    () => location.hash,
    () => "",
  );
  return /(?:^#|&)token=([A-Za-z0-9_-]{43})(?:&|$)/.exec(hash)?.[1] ?? null;
}
const forgetLink = () => history.replaceState(null, "", location.pathname);

function Title({ children, body }: { children: React.ReactNode; body?: React.ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-h2 leading-snug text-balance">{children}</h1>
      {body && <p className="mt-2 text-small text-pretty text-muted-foreground">{body}</p>}
    </header>
  );
}
function Field({ label, hint, ...props }: React.ComponentProps<typeof Input> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="h-11 rounded-xl text-ui" aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {hint && <p id={`${id}-hint`} className="text-caption text-faint">{hint}</p>}
    </div>
  );
}
function PasswordField({ label, hint, value, onChange, autoComplete }: { label: string; hint?: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const t = useT();
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} type={shown ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} required
          className="h-11 rounded-xl pr-20 text-ui" aria-describedby={hint ? `${id}-hint` : undefined} />
        <button type="button" onClick={() => setShown(!shown)} aria-pressed={shown} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg px-2.5 py-1 text-caption text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
          {shown ? t.account.hide : t.account.show}
        </button>
      </div>
      {hint && <p id={`${id}-hint`} className="text-caption text-faint">{hint}</p>}
    </div>
  );
}
const Submit = ({ busy, label, busyLabel, disabled }: { busy: boolean; label: string; busyLabel: string; disabled?: boolean }) => (
  <Button type="submit" disabled={busy || disabled} className="mt-2 h-11 w-full rounded-full text-ui">{busy ? busyLabel : label}</Button>
);
const Alert = ({ children }: { children: React.ReactNode }) => <p role="alert" className="text-small text-pretty text-destructive">{children}</p>;
function Done({ icon = "mail", title, body, children }: { icon?: "mail" | "check"; title: string; body: string; children?: React.ReactNode }) {
  const Icon = icon === "mail" ? MailIcon : CheckIcon;
  return (
    <div role="status">
      <span aria-hidden className="mb-5 grid size-10 place-items-center rounded-full border border-border"><Icon className="size-4.5 text-primary" strokeWidth={1.75} /></span>
      <Title body={body}>{title}</Title>
      {children}
    </div>
  );
}
const Foot = ({ children }: { children: React.ReactNode }) => <p className="mt-6 border-t border-border pt-5 text-center text-small text-muted-foreground">{children}</p>;
const A = ({ href, children }: { href: string; children: React.ReactNode }) => <Link href={href} className="text-primary underline-offset-4 hover:underline">{children}</Link>;

export function SignIn({ admin = true }: { admin?: boolean }) {
  const t = useT();
  const a = t.account;
  const router = useRouter();
  const signIn = useStore((s) => s.signInWithPassword);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const [resent, setResent] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await signIn(email, password);
    setBusy(false);
    if (r.ok) return router.push("/home");
    setError({ text: errorText(t, r), code: r.code });
  };
  const resend = async () => {
    await call("/api/account/resend", { email });
    setResent(true);
  };
  return (
    <>
      <Title>{a.signIn.title}</Title>
      <form onSubmit={submit} className="grid gap-4">
        <Field label={a.email} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <PasswordField label={a.password} autoComplete="current-password" value={password} onChange={setPassword} />
        <div className="-mt-1 text-right text-small"><A href="/account/forgot">{a.signIn.forgot}</A></div>
        {error && <Alert>{error.text}</Alert>}
        {error?.code === "email_unverified" && (resent
          ? <p role="status" className="text-small text-muted-foreground">{a.signIn.resent}</p>
          : <Button type="button" variant="secondary" className="h-10 rounded-full border-border text-small" onClick={() => void resend()}>{a.signIn.resend}</Button>)}
        <Submit busy={busy} label={a.signIn.submit} busyLabel={a.signIn.busy} />
      </form>
      <Foot>{a.signIn.noAccount} <A href="/account/sign-up">{a.signIn.create}</A></Foot>
      {admin && <p className="mt-3 text-center text-caption"><Link href="/operator" className="text-faint hover:text-foreground">{a.signIn.admin}</Link></p>}
    </>
  );
}

export function SignUp({ approval = true, verification = true }: { approval?: boolean; verification?: boolean }) {
  const t = useT();
  const a = t.account;
  const router = useRouter();
  const signIn = useStore((s) => s.signInWithPassword);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call("/api/account/register", { email, password });
    if (!r.ok) { setBusy(false); return setError(errorText(t, r)); }
    if (verification) { setBusy(false); return setSent(true); }
    // No confirmation mail: sign in with what was just typed. The server's answer to sign-up is the same for every address, so a sign-in that
    // fails here usually means the address already has an account with another password.
    const s = await signIn(email, password);
    if (s.ok) return router.push("/home");
    setBusy(false);
    setError(s.code === "invalid_credentials" ? a.signUp.signInFailed : errorText(t, s));
  };
  if (sent) return <VerifyInline email={email.trim()} password={password} onChange={() => setSent(false)} />;
  return (
    <>
      <Title body={!verification ? (approval ? a.signUp.bodyApproval : a.signUp.bodyInstant) : approval ? a.signUp.body : a.signUp.bodyOpen}>{a.signUp.title}</Title>
      <form onSubmit={submit} className="grid gap-4">
        <Field label={a.email} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <PasswordField label={a.password} hint={a.passwordHint(MIN)} autoComplete="new-password" value={password} onChange={setPassword} />
        {error && <Alert>{error}</Alert>}
        <Submit busy={busy} label={a.signUp.submit} busyLabel={a.signUp.busy} disabled={password.length < MIN} />
      </form>
      <Foot>{a.signUp.have} <A href="/account/sign-in">{a.signIn.submit}</A></Foot>
    </>
  );
}

/**
 * After sign-up: the same card says what to do next, and continues by itself. The address is confirmed through the mailed link, on this or any
 * device; this page then signs in with the password that was just typed here (kept only in this page's memory), which the server allows only
 * once the address is confirmed. Until then every protected page and API refuses the account, exactly as before.
 */
function VerifyInline({ email, password, onChange }: { email: string; password: string; onChange: () => void }) {
  const t = useT();
  const a = t.account.signUp;
  const router = useRouter();
  const signIn = useStore((s) => s.signInWithPassword);
  const [state, setState] = useState<"waiting" | "continuing" | "approval" | "stopped">("waiting");
  // The cooldown is a moment in time, not a count of ticks: a hidden tab (the person is in their mail app) runs timers late.
  const [resendAt, setResendAt] = useState(() => Date.now() + RESEND_COOLDOWN * 1000);
  const [now, setNow] = useState(() => Date.now());
  const cooldown = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const checking = useRef(false);
  const [started] = useState(() => Date.now());

  /** One check: a sign-in that succeeds only once the address is confirmed. Anything but "not confirmed yet" ends the checking. */
  const check = useCallback(async () => {
    if (checking.current) return "busy" as const;
    checking.current = true;
    const r = await signIn(email, password);
    checking.current = false;
    if (r.ok) { setState("continuing"); router.push("/home"); return "done" as const; }
    if (r.code === "email_unverified") return "wait" as const;
    if (r.code === "rate_limited") return "slow" as const;
    setState(r.code === "pending_approval" ? "approval" : "stopped");
    return "done" as const;
  }, [email, password, signIn, router]);

  // Checks every few seconds, then less often; stops after 30 minutes. Sooner when this tab is looked at again or another tab confirmed.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>, alive = true;
    const loop = async () => {
      if (!alive) return;
      const waited = Date.now() - started;
      if (waited > 30 * 60_000) return setState((s) => (s === "waiting" ? "stopped" : s));
      const r = document.hidden ? "wait" : await check();
      if (!alive || r === "done") return;
      timer = setTimeout(loop, r === "slow" ? 60_000 : waited < 60_000 ? 3_000 : waited < 5 * 60_000 ? 6_000 : 15_000);
    };
    timer = setTimeout(loop, 3_000);
    const now = () => { if (!document.hidden) void check(); };
    document.addEventListener("visibilitychange", now);
    let channel: BroadcastChannel | null = null;
    try { channel = new BroadcastChannel(ACCOUNT_CHANNEL); channel.onmessage = now; } catch {}
    return () => { alive = false; clearTimeout(timer); document.removeEventListener("visibilitychange", now); channel?.close(); };
  }, [check, started]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [cooldown]);

  const resend = async () => {
    setBusy(true);
    const r = await call("/api/account/resend", { email });
    setBusy(false);
    if (!r.ok) return setNote({ text: errorText(t, r), error: true });
    setNote({ text: a.resent });
    const t0 = Date.now();
    setNow(t0);
    setResendAt(t0 + RESEND_COOLDOWN * 1000);
  };

  return (
    <div>
      <Title body={a.verifyBody(email)}>{a.verifyTitle}</Title>
      <p role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 text-small">
        {state === "continuing" ? <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden />
          : state === "waiting" ? <span aria-hidden className="relative grid size-2.5 shrink-0 place-items-center"><span className="absolute inline-flex size-full rounded-full bg-primary/40 motion-safe:animate-ping" /><span className="relative size-2 rounded-full bg-primary" /></span>
          : <MailIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="text-pretty">{state === "continuing" ? a.continuing : state === "approval" ? t.account.verify.waiting : state === "stopped" ? a.stopped : a.waiting}</span>
      </p>
      {state !== "continuing" && (
        <div className="mt-5 grid gap-2">
          <Button type="button" variant="secondary" disabled={busy || cooldown > 0} onClick={() => void resend()} className="h-11 w-full rounded-full border-border text-ui tabular-nums">
            {cooldown > 0 ? a.resendIn(cooldown) : a.resend}
          </Button>
          {note ? <p role={note.error ? "alert" : "status"} className={note.error ? "text-small text-destructive" : "text-caption text-muted-foreground"}>{note.text}</p>
            : <p className="text-caption text-faint">{a.resendLimit}</p>}
        </div>
      )}
      <Foot>
        {state === "stopped" ? <A href="/account/sign-in">{t.account.signIn.submit}</A>
          : <button type="button" onClick={onChange} className="text-primary underline-offset-4 hover:underline">{a.change}</button>}
      </Foot>
    </div>
  );
}

export function Verify() {
  const t = useT();
  const a = t.account;
  const token = useLinkToken();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ approved: boolean } | null>(null);
  // Confirmed by a click, not on opening: a mail scanner that follows the link must not use it up.
  const confirm = async () => {
    setBusy(true);
    setError(null);
    const r = await call<{ approved: boolean }>("/api/account/verify", { token });
    setBusy(false);
    if (!r.ok) return setError(errorText(t, r));
    forgetLink();
    setDone(r.data);
    // A sign-up page waiting in another tab of this browser continues now instead of at its next check.
    try { const c = new BroadcastChannel(ACCOUNT_CHANNEL); c.postMessage("verified"); c.close(); } catch {}
  };
  if (done)
    return (
      <Done icon="check" title={a.verify.doneTitle} body={done.approved ? a.verify.readyAuto : a.verify.waiting}>
        {done.approved && <Button asChild className="mt-2 h-11 w-full rounded-full text-ui"><Link href="/home">{a.verify.continue}</Link></Button>}
        <Foot><A href="/account/sign-in">{a.back}</A></Foot>
      </Done>
    );
  return (
    <>
      <Title body={token ? undefined : a.verify.missing}>{a.verify.title}</Title>
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {token && <Button disabled={busy} onClick={() => void confirm()} className="h-11 w-full rounded-full text-ui">{busy ? a.verify.busy : a.verify.submit}</Button>}
      <Foot><A href="/account/sign-in">{a.back}</A></Foot>
    </>
  );
}

export function Forgot() {
  const t = useT();
  const a = t.account;
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call("/api/account/forgot", { email });
    setBusy(false);
    if (r.ok) setSent(true);
    else setError(errorText(t, r));
  };
  if (sent) return <Done title={a.forgot.sentTitle} body={a.forgot.sent}><Foot><A href="/account/sign-in">{a.back}</A></Foot></Done>;
  return (
    <>
      <Title body={a.forgot.body}>{a.forgot.title}</Title>
      <form onSubmit={submit} className="grid gap-4">
        <Field label={a.email} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        {error && <Alert>{error}</Alert>}
        <Submit busy={busy} label={a.forgot.submit} busyLabel={a.forgot.busy} />
      </form>
      <Foot><A href="/account/sign-in">{a.back}</A></Foot>
    </>
  );
}

export function Reset() {
  const t = useT();
  const a = t.account;
  const token = useLinkToken();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call("/api/account/reset", { token, password });
    setBusy(false);
    if (!r.ok) return setError(errorText(t, r));
    forgetLink();
    setDone(true);
  };
  if (done) return <Done icon="check" title={a.reset.doneTitle} body={a.reset.done}><Foot><A href="/account/sign-in">{a.back}</A></Foot></Done>;
  if (!token) return <><Title body={a.verify.missing}>{a.reset.title}</Title><Foot><A href="/account/forgot">{a.forgot.submit}</A></Foot></>;
  return (
    <>
      <Title body={a.reset.body}>{a.reset.title}</Title>
      <form onSubmit={submit} className="grid gap-4">
        <PasswordField label={a.newPassword} hint={a.passwordHint(MIN)} autoComplete="new-password" value={password} onChange={setPassword} />
        {error && <Alert>{error}</Alert>}
        <Submit busy={busy} label={a.reset.submit} busyLabel={a.reset.busy} disabled={password.length < MIN} />
      </form>
      <Foot><A href="/account/sign-in">{a.back}</A></Foot>
    </>
  );
}
