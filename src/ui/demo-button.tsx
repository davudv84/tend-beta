"use client";

import { ChevronRightIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

/**
 * "Try the live demo": one click into the read-only demo account (POST /api/account/demo), then its Overview. On the public site it is the
 * white pill of the marketing kit; the line under it says what the demo is, and says so plainly when it could not be opened.
 */
export function DemoButton({ className, note = true }: { className?: string; note?: boolean }) {
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
    <span className={cn("inline-grid justify-items-center gap-2 sm:justify-items-start", className)}>
      <button type="button" onClick={open} disabled={state === "busy"} aria-busy={state === "busy"}
        className="group inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-white px-5 text-[15px] font-medium text-[#141414] outline-none transition-colors hover:bg-[#e6e6e6] disabled:opacity-70">
        {state === "busy" ? w.liveDemoOpening : w.liveDemo}
        <ChevronRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} aria-hidden />
      </button>
      {(note || state === "failed") && (
        <span role={state === "failed" ? "alert" : undefined} className={cn("text-[13px]", state === "failed" ? "text-[#ff8a80]" : "text-muted-foreground")}>
          {state === "failed" ? w.liveDemoFailed : w.liveDemoNote}
        </span>
      )}
    </span>
  );
}
