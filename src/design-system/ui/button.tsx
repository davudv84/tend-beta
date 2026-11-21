"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Slot } from "radix-ui";
import { cx } from "../cx";
import { Icon } from "./icons";
import { Tooltip } from "./tooltip";

export const buttonStyles = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap select-none rounded-t-md font-medium",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-(--t-dur-fast) ease-t-out",
    "active:scale-[0.985] active:duration-(--t-dur-instant)",
    "disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: "bg-t-accent text-t-accent-fg shadow-t-button hover:bg-t-accent-hover active:bg-t-accent-press",
        secondary: "border border-t-line-strong bg-t-surface text-t-ink shadow-t-1 hover:bg-t-sunken active:bg-t-sunken",
        ghost: "text-t-text hover:bg-t-sunken hover:text-t-ink active:bg-t-line",
        destructive: "bg-t-danger text-t-danger-fg shadow-t-button hover:bg-t-danger-hover",
      },
      size: {
        sm: "h-8 px-3 text-t-label",
        md: "h-[var(--t-control-h)] px-[var(--t-control-px)] text-t-label",
        lg: "h-12 px-6 text-t-body font-medium tracking-[-0.011em]",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {
  loading?: boolean;
  leading?: LucideIcon;
  trailing?: LucideIcon;
  asChild?: boolean;
}

/** The dark-on-light "destructive" text colour needs white, not the accent's foreground, in both themes. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading, leading, trailing, asChild, className, children, disabled, type = "button", ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  const iconSize = size === "sm" ? "sm" : "md";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(buttonStyles({ variant, size }), className)}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          <span className={cx("inline-flex items-center gap-2", loading && "opacity-0")}>
            {leading && <Icon icon={leading} size={iconSize} />}
            {children}
            {trailing && <Icon icon={trailing} size={iconSize} />}
          </span>
          {loading && <Spinner className="absolute" />}
        </>
      )}
    </Comp>
  );
});

export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg role="status" aria-label="Loading" viewBox="0 0 16 16" width={size} height={size} className={cx("t-spin", className)} fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** A square button with an icon only. The label is required: it names the control for assistive tech and appears as a tooltip. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "leading" | "trailing" | "children"> & { icon: LucideIcon; label: string; tooltip?: boolean; extra?: ReactNode }
>(function IconButton({ icon, label, variant = "ghost", size, tooltip = true, className, loading, ...props }, ref) {
  const dim = size === "sm" ? "size-8 !px-0" : size === "lg" ? "size-12 !px-0" : "size-[var(--t-control-h)] !px-0";
  const button = (
    <Button ref={ref} variant={variant} size={size} aria-label={label} loading={loading} className={cx(dim, className)} {...props}>
      <Icon icon={icon} size={size === "lg" ? "lg" : "md"} />
    </Button>
  );
  return tooltip ? <Tooltip label={label}>{button}</Tooltip> : button;
});
