import Link from "next/link";
import { Mark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";

export default async function NotFound() {
  const t = await getT();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Mark cell={3} className="mb-6" />
      <p className="eyebrow mb-3">404</p>
      <h1 className="text-2xl font-semibold">{t.notFound.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t.notFound.body}</p>
      <div className="mt-8 flex gap-2">
        <Button asChild><Link href="/sanctuary">{t.notFound.enter}</Link></Button>
        <Button asChild variant="ghost"><Link href="/">{t.notFound.home}</Link></Button>
      </div>
    </main>
  );
}
