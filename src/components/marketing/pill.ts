import { cn } from "@/lib/utils";

/** The homepage's buttons: pills. `light` is the white one, `dark` the quiet one on a dark surface. Used on the shared Button. */
export const pill = (kind: "light" | "dark" = "light", size: "md" | "lg" = "md") =>
  cn(
    "rounded-full font-medium transition-colors",
    size === "lg" ? "h-12 px-7 text-[15px]" : "h-10 px-5 text-[14px]",
    kind === "light" ? "bg-white text-[#171717] hover:bg-[#e9e9e4]" : "border border-border bg-mk-raised text-foreground hover:bg-[#1b1f1c]",
  );
