"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Checkbox as C, Select as S, Switch as W } from "radix-ui";
import { Check, ChevronDown, CircleAlert, Search, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cx } from "../cx";
import { usePortalContainer } from "../scope";
import { Icon } from "./icons";

/** Shared control surface: border, hover, focus and invalid states are identical across every field. */
const control = [
  "w-full rounded-t-md border border-t-line-strong bg-t-surface text-t-ink placeholder:text-t-subtle",
  "shadow-t-1 transition-[border-color,box-shadow,background-color] duration-(--t-dur-fast) ease-t-out",
  "hover:border-t-subtle",
  "focus-visible:border-t-accent focus-visible:shadow-[var(--t-ring)] focus-visible:outline-none",
  "aria-[invalid=true]:border-t-danger aria-[invalid=true]:focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--t-danger)_24%,transparent)]",
  "disabled:cursor-not-allowed disabled:bg-t-sunken disabled:opacity-60 disabled:shadow-none disabled:hover:border-t-line-strong",
].join(" ");

/* ---------------------------------------------------------------- Field */

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

/** Label, hint and error around one control. The control receives the ids it needs, so the pairing is never forgotten. */
export function Field({
  label,
  hint,
  error,
  optional,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: (p: FieldControlProps) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline justify-between text-t-label text-t-ink">
        {label}
        {optional && <span className="text-t-caption font-normal text-t-muted">Optional</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-t-caption text-t-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="flex items-center gap-1.5 text-t-caption text-t-danger-ink">
          <Icon icon={CircleAlert} size="xs" />
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Input / Search / Textarea */

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { leading?: LucideIcon; mono?: boolean }
>(function Input({ className, leading, mono, ...props }, ref) {
  const field = (
    <input
      ref={ref}
      className={cx(control, "h-[var(--t-control-h)] px-3 text-t-small", mono && "font-t-mono text-t-code", leading && "pl-9", className)}
      {...props}
    />
  );
  if (!leading) return field;
  return (
    <div className="relative">
      <Icon icon={leading} size="md" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-t-subtle" />
      {field}
    </div>
  );
});

export const SearchInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "value"> & { value: string; onValueChange: (v: string) => void; shortcut?: string }
>(function SearchInput({ value, onValueChange, shortcut = "/", className, placeholder = "Search", ...props }, ref) {
  return (
    <div className={cx("relative", className)}>
      <Icon icon={Search} size="md" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-t-subtle" />
      <input
        ref={ref}
        type="search"
        role="searchbox"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && value && onValueChange("")}
        className={cx(control, "h-[var(--t-control-h)] pr-16 pl-9 text-t-small [&::-webkit-search-cancel-button]:hidden")}
        {...props}
      />
      <div className="absolute top-1/2 right-2 -translate-y-1/2">
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onValueChange("")}
            className="grid size-6 place-items-center rounded-t-sm text-t-muted transition-colors duration-(--t-dur-fast) hover:bg-t-sunken hover:text-t-ink"
          >
            <Icon icon={X} size="sm" />
          </button>
        ) : (
          <kbd aria-hidden className="rounded-t-xs border border-t-line bg-t-canvas px-1.5 font-mono text-[0.75rem] leading-5 text-t-muted">
            {shortcut}
          </kbd>
        )}
      </div>
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 4, ...props },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cx(control, "min-h-24 resize-y px-3 py-2.5 text-t-small", className)} {...props} />;
});

/* ---------------------------------------------------------------- Select */

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export function Select({
  options,
  value,
  onValueChange,
  placeholder = "Choose…",
  id,
  disabled,
  ...aria
}: {
  options: SelectOption[];
  value?: string;
  onValueChange?: (v: string) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
} & Pick<FieldControlProps, "aria-describedby" | "aria-invalid">) {
  const container = usePortalContainer();
  return (
    <S.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <S.Trigger
        id={id}
        {...aria}
        className={cx(control, "group flex h-[var(--t-control-h)] items-center justify-between gap-2 px-3 text-left text-t-small data-[placeholder]:text-t-subtle")}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon asChild>
          <ChevronDown size={16} strokeWidth={1.75} className="shrink-0 text-t-muted transition-transform duration-(--t-dur-base) ease-t-out group-data-[state=open]:rotate-180" />
        </S.Icon>
      </S.Trigger>
      <S.Portal container={container}>
        <S.Content
          position="popper"
          sideOffset={6}
          className="t-menu z-50 w-(--radix-select-trigger-width) min-w-44 overflow-hidden rounded-t-lg border border-t-line bg-t-raised p-1 text-t-text shadow-t-2"
        >
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer items-center justify-between gap-3 rounded-t-sm py-2 pr-8 pl-2.5 text-t-small outline-none select-none data-[disabled]:opacity-45 data-[highlighted]:bg-t-sunken data-[highlighted]:text-t-ink"
              >
                <S.ItemText>{o.label}</S.ItemText>
                {o.hint && <span className="text-t-caption text-t-muted">{o.hint}</span>}
                <S.ItemIndicator className="absolute right-2.5 text-t-accent-text">
                  <Check size={14} strokeWidth={2} />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

/* ---------------------------------------------------------------- Checkbox / Switch */

export function Checkbox({
  label,
  description,
  className,
  ...props
}: Omit<C.CheckboxProps, "children"> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className={cx("flex items-start gap-3", className)}>
      <C.Root
        id={id}
        className={cx(
          "group mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-[5px] border border-t-line-strong bg-t-surface shadow-t-1",
          "transition-[background-color,border-color,box-shadow] duration-(--t-dur-fast) ease-t-out hover:border-t-subtle",
          "data-[state=checked]:border-t-accent data-[state=checked]:bg-t-accent data-[state=indeterminate]:border-t-accent data-[state=indeterminate]:bg-t-accent",
          "focus-visible:shadow-[var(--t-ring)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45",
        )}
        {...props}
      >
        <C.Indicator className="text-t-accent-fg data-[state=checked]:animate-[t-fade-in_var(--t-dur-fast)_var(--t-ease-out)]">
          {props.checked === "indeterminate" ? <span className="block h-0.5 w-2 rounded-full bg-current" /> : <Check size={12} strokeWidth={3} />}
        </C.Indicator>
      </C.Root>
      <label htmlFor={id} className="flex flex-col gap-0.5 text-t-small leading-[1.4] text-t-ink select-none">
        {label}
        {description && <span className="text-t-caption text-t-muted">{description}</span>}
      </label>
    </div>
  );
}

export function Switch({ label, description, className, ...props }: W.SwitchProps & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className={cx("flex items-start justify-between gap-6", className)}>
      <label htmlFor={id} className="flex flex-col gap-0.5 text-t-small leading-[1.4] text-t-ink select-none">
        {label}
        {description && <span className="text-t-caption text-t-muted">{description}</span>}
      </label>
      <W.Root
        id={id}
        className={cx(
          "relative mt-px h-[22px] w-10 shrink-0 rounded-full border border-transparent bg-t-line-strong",
          "transition-[background-color,box-shadow] duration-(--t-dur-base) ease-t-out",
          "hover:bg-t-subtle data-[state=checked]:bg-t-accent data-[state=checked]:hover:bg-t-accent-hover",
          "focus-visible:shadow-[var(--t-ring)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45",
        )}
        {...props}
      >
        <W.Thumb className="block size-[18px] translate-x-[1px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.3)] transition-transform duration-(--t-dur-base) ease-t-out data-[state=checked]:translate-x-[19px] data-[state=checked]:bg-t-accent-fg" />
      </W.Root>
    </div>
  );
}
