import type { LucideIcon } from "lucide-react";

/**
 * Icon rules. One library (Lucide), one drawing style: outline, round caps and joins.
 *  xs 12  inline with caption text, badges           stroke 2
 *  sm 14  small buttons, table cells                 stroke 1.75
 *  md 16  default: buttons, inputs, menu items       stroke 1.75
 *  lg 20  sidebar items, alerts, empty-state header  stroke 1.5
 *  xl 24  feature, onboarding                        stroke 1.5
 * Icons sit on the text's optical centre, with an 8px gap to a label (6px when small). Their colour follows the text unless
 * the icon carries status. An icon never stands alone without an accessible name.
 */
export const ICON_SIZES = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24 } as const;
export const ICON_STROKE = { xs: 2, sm: 1.75, md: 1.75, lg: 1.5, xl: 1.5 } as const;
export type IconSize = keyof typeof ICON_SIZES;

export function Icon({ icon: Glyph, size = "md", className }: { icon: LucideIcon; size?: IconSize; className?: string }) {
  return <Glyph aria-hidden size={ICON_SIZES[size]} strokeWidth={ICON_STROKE[size]} className={className ?? "shrink-0"} />;
}
