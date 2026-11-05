import { BrandMark } from "@/ui/brand-mark";
import { cn } from "@/lib/utils";

/** The small white pill above a heading: a dark icon dot and a few words. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-7 items-center gap-2 rounded-full bg-white py-0.5 pr-3 pl-1.5 text-[12px] font-medium text-[#171717]", className)}>
      <span aria-hidden className="grid size-[18px] place-items-center rounded-full bg-[#171717]">
        <BrandMark className="size-2.5 text-white" />
      </span>
      {children}
    </span>
  );
}
