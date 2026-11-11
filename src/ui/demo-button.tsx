"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

/** "Try the live demo": one click into the read-only demo account (POST /api/account/demo), then its Overview. */
export function DemoButton({ className }: { className?: string }) {
  const t = useT();
  const w = t.front;
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const open = async () => {
    setState("busy");
    const r = await fetch("/api/account/demo", { method: "POST" }).catch(() => null);
    if (r?.ok) router.push("/home");
    else setState("failed");
  };
  return (
    <div className={cn("grid gap-2", className)}>
      <button type="button" onClick={open} disabled={state === "busy"} aria-busy={state === "busy"}
        className="inline-flex h-12 w-fit items-center rounded-full bg-primary px-7 text-ui font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-70">
        {state === "busy" ? w.demoOpening : w.demo}
      </button>
      <p role={state === "failed" ? "alert" : undefined} className={cn("text-small", state === "failed" ? "text-[#b42318]" : "text-muted-foreground")}>
        {state === "failed" ? w.demoFailed : w.demoNote}
      </p>
    </div>
  );
}
