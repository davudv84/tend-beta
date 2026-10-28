import type { ChildProcess } from "node:child_process";
export const canConfine: () => boolean;
export const HOME_SECRETS: string[];
export function buildProfile(o: { root: string; hidden?: string[]; home?: string; readable?: string[] }): string;
export function buildServerProfile(o: { root: string; allowWrite?: string[]; hidden?: string[]; home?: string }): string;
export function confinedSpawn(argv: string[], o: { root: string; hidden?: string[]; home?: string; env?: Record<string, string | undefined>; cwd?: string; stdio?: "inherit" | "pipe" | ("pipe" | "inherit" | "ignore")[] }): ChildProcess;
