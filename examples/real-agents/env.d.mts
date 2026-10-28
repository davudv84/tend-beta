export function loadAgentEnvDetailed(root?: string): { env: Record<string, string>; fromFile: Record<string, string>; fromShell: Record<string, string> };
export function loadAgentEnv(root?: string): Record<string, string>;
export const keyVar: (provider: string) => string | undefined;
export const keyPrefix: (key: string) => string;
export function resolveAgent(d: { env: Record<string, string | undefined>; fromFile: Record<string, string | undefined>; fromShell: Record<string, string | undefined> }, provider: string): { key?: string; variable?: string; source?: string; url: string; warnings: string[] };
export function explainRejectedKey(k: { key?: string; source?: string; url: string }, provider: string): string;
export function need(env: Record<string, string | undefined>, names: string[], hint: string): void;
