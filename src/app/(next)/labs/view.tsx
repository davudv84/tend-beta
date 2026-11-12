"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronRightIcon } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogTrigger, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n/error-text";
import { useStore } from "@/lib/store";
import { Page, PageSkeleton } from "@/ui/page";

/** Research experiments, kept together and kept apart from how Tend controls assistants. */
export default function View() {
  const t = useT();
  const g = t.labs;
  const router = useRouter();
  const ready = useStore((s) => s.ready);
  const operator = useStore((s) => !!s.viewer?.canAct);
  const demo = useStore((s) => !!s.viewer?.demo);
  const resetDemo = useStore((s) => s.resetDemo);
  const setPrefs = useStore((s) => s.setPrefs);
  const [confirm, setConfirm] = useState(false);
  if (!ready) return <PageSkeleton label={t.home.loading} />;
  const items = [
    { href: "/sanctuary", ...t.nav.items.sanctuary },
    { href: "/reflections", ...t.nav.items.reflections },
    { href: "/check-ins", ...t.nav.items.checkIns },
    { href: "/research", ...t.nav.items.research },
    { href: "/prototype", label: g.prototype, hint: g.prototypeHint },
  ];
  return (
    <Page>
      <h1 className="text-section text-balance">{g.title}</h1>
      <p className="mt-4 max-w-[52ch] text-lead text-pretty text-muted-foreground">{g.body}</p>
      <ul className="mt-12">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="group -mx-4 flex items-center gap-4 rounded-2xl px-4 py-3.5 transition-colors duration-200 hover:bg-sunken">
              <div className="min-w-0 flex-1">
                <p className="text-ui font-medium">{i.label}</p>
                <p className="mt-0.5 text-small text-muted-foreground">{i.hint}</p>
              </div>
              <ChevronRightIcon className="size-4 shrink-0 text-faint transition-transform duration-200 ease-[var(--ease-out)] group-hover:translate-x-0.5" strokeWidth={1.75} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-2 text-small text-muted-foreground">
        <button type="button" className="rounded-md underline-offset-4 hover:text-foreground hover:underline" onClick={() => { setPrefs({ welcomeDone: false, introDone: false }); router.push("/sanctuary"); }}>{t.shell.restartIntro}</button>
        {operator && demo && (
          <AlertDialog open={confirm} onOpenChange={setConfirm}>
            <AlertDialogTrigger asChild><button type="button" className="rounded-md underline-offset-4 hover:text-foreground hover:underline">{t.shell.resetDemo}</button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t.shell.resetTitle}</AlertDialogTitle>
                <AlertDialogDescription>{t.shell.resetBody}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                <AlertDialogAction onClick={async () => {
                  const r = await resetDemo();
                  if (r.ok) toast.success(t.shell.resetDone);
                  else toast.error(t.shell.resetFailed, { description: errorText(t, r) });
                }}>{t.shell.reset}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </Page>
  );
}
