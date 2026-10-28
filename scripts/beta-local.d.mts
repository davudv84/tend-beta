export function provision(work: string, names: string[]): { name: string; port: number }[];
export function loadAll(work: string): { instances: Record<string, Record<string, string>>; modes: Record<string, number> };
export function check(instances: Record<string, Record<string, string>>, modes?: Record<string, number>): { instance: string; level: "fail" | "warn" | "ok"; text: string }[];
export function tunnelConfig(instances: Record<string, Record<string, string>>, domain: string): string;
export function startAll(o: { root: string; work?: string; confined?: boolean; log?: (s: string) => void }): Promise<{ servers: Record<string, { url: string; stop(): Promise<void> }>; instances: Record<string, Record<string, string>>; stop(): Promise<void> }>;
