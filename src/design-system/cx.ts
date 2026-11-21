/** Joins class names. Deliberately no Tailwind conflict resolution: components never override each other's utilities. */
export const cx = (...v: Array<string | false | null | undefined>) => v.filter(Boolean).join(" ");
