import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { config } from "@/server/config";
import { getDb } from "@/server/db";
import { isOperator } from "@/server/session";
import { DemoButton } from "@/ui/demo-button";
import { PublicFrame } from "@/ui/frame";
import { PREFS_COOKIE, prefsFromCookie } from "@/ui/prefs";
import { UiPrefsProvider } from "@/ui/prefs-context";
import { Badge, type Tone } from "@/ui/primitives";

/** The three example calls (code, so not translated) and how Balanced answers each; the words for them come from the dictionary. */
const EXAMPLES: { command: string; tone: Tone }[] = [{ command: "npm test", tone: "good" }, { command: "git push origin main", tone: "attention" }, { command: "cat ~/.ssh/id_ed25519", tone: "danger" }];

/**
 * The front page: what TEND is, the demo video, how it works, what a decision looks like, and what TEND does not claim. An operator who is
 * already signed in goes straight to their Home. The example rows are written out, not live data, and match the Balanced preset.
 */
export default async function FrontPage() {
  const h = await headers();
  if (await isOperator(await getDb(), new Request("http://localhost/", { headers: h }))) redirect("/home");
  const t = await getT();
  const w = t.front;
  const initial = prefsFromCookie((await cookies()).get(PREFS_COOKIE)?.value);
  const demo = config.accounts && !!config.demoAccount;
  const col = "mx-auto w-full max-w-[680px] px-6";
  const actions = (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
      {demo && <DemoButton />}
      <div className="flex h-12 flex-wrap items-center gap-x-6 gap-y-2">
        {config.accounts && <Link href="/account/sign-up" className={demo ? "rounded-md text-ui font-medium underline-offset-4 hover:underline" : "inline-flex h-12 items-center rounded-full bg-primary px-7 text-ui font-medium text-primary-foreground"}>{w.create}</Link>}
        <Link href={config.accounts ? "/account/sign-in" : "/operator"} className="rounded-md text-ui text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{w.signIn}</Link>
      </div>
    </div>
  );
  return (
    <UiPrefsProvider initial={initial}>
      <PublicFrame>
        <section className={`${col} pt-16 md:pt-24`}>
          <h1 className="text-headline max-w-[16ch] text-balance">{w.title}</h1>
          <p className="mt-6 max-w-[52ch] text-lead text-pretty text-muted-foreground">{w.body}</p>
          <div className="mt-10">{actions}</div>
        </section>

        <section aria-labelledby="video" className="mx-auto mt-20 w-full max-w-[920px] px-6">
          <h2 id="video" className="sr-only">{w.video.title}</h2>
          <video controls playsInline preload="metadata" poster="/demo/tend-demo.jpg" aria-label={w.video.label}
            className="aspect-video w-full rounded-3xl border border-border bg-sunken">
            <source src="/demo/tend-demo.mp4" type="video/mp4" />
          </video>
          <p className="mx-auto mt-4 max-w-[680px] text-small text-pretty text-muted-foreground">{w.video.caption}</p>
        </section>

        <section aria-labelledby="how" className={`${col} mt-24`}>
          <h2 id="how" className="text-h2">{w.how.title}</h2>
          <ol className="mt-8 grid gap-8">
            {w.how.steps.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[2rem_1fr] gap-x-4">
                <span aria-hidden className="text-ui font-medium tabular-nums text-faint">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="text-ui font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-body text-pretty text-muted-foreground">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="example" className={`${col} mt-24`}>
          <h2 id="example" className="text-h2">{w.example.title}</h2>
          <p className="mt-3 text-body text-pretty text-muted-foreground">{w.example.sub}</p>
          <div className="mt-8 overflow-hidden rounded-3xl border border-border">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-sunken text-[13px] text-muted-foreground">
                <tr>{w.example.columns.map((c, i) => <th key={c} scope="col" className={`px-5 py-3 font-normal ${i === 2 ? "hidden sm:table-cell" : ""}`}>{c}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {w.example.rows.map((r, i) => (
                  <tr key={EXAMPLES[i].command}>
                    <td className="px-5 py-4 font-mono text-[13px] [overflow-wrap:anywhere]">{EXAMPLES[i].command}<span className="mt-1 block font-sans text-[13px] text-muted-foreground sm:hidden">{r.reason}</span></td>
                    <td className="px-5 py-4 whitespace-nowrap"><Badge tone={EXAMPLES[i].tone}>{r.outcome}</Badge></td>
                    <td className="hidden px-5 py-4 text-muted-foreground sm:table-cell">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="limits" className={`${col} mt-24`}>
          <h2 id="limits" className="text-h2">{w.limits.title}</h2>
          <ul className="mt-6 grid gap-3 text-body text-muted-foreground">
            {w.limits.items.map((p) => (
              <li key={p} className="flex gap-3"><span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-faint" /><span className="text-pretty">{p}</span></li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="closing" className={`${col} mt-24 pb-24`}>
          <div className="rounded-3xl border border-border px-6 py-8 sm:px-8">
            <h2 id="closing" className="text-h2">{w.closing.title}</h2>
            <p className="mt-3 max-w-[52ch] text-body text-pretty text-muted-foreground">{w.closing.body}</p>
            <div className="mt-8">{actions}</div>
          </div>
        </section>
      </PublicFrame>
    </UiPrefsProvider>
  );
}
