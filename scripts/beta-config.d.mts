export function newConfig(): Record<string, string>;
export function provision(root: string, names: string[]): string[];
export function check(instances: Record<string, Record<string, string | undefined>>): { instance: string; level: "fail" | "warn" | "ok"; text: string }[];
export function loadAll(root: string): { instances: Record<string, Record<string, string>>; modes: [string, number][] };
