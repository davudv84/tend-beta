export interface IsolatedServer { url: string; port: number; dir: string; health: { ok: boolean; storage: string; schema: number }; stop(): Promise<void>; output(): string; pids(): number[] }
export const processTree: (pid: number) => number[];
export const listeners: (port: number) => number[];
export const freePort: () => Promise<number>;
export function startIsolatedServer(o: { root: string; env: Record<string, string>; database?: "embedded" | "postgres"; port?: number; confine?: { allowWrite?: string[]; hidden?: string[] }; keepDir?: boolean }): Promise<IsolatedServer>;
