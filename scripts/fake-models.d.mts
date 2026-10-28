import type { IncomingMessage, ServerResponse } from "node:http";
export interface FakeServer { url: string; close: () => Promise<void> }
export interface ScriptedCall { name: string; input: Record<string, string>; id?: string }
export interface Script { turns: ScriptedCall[][]; final: string }
export function listen(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): Promise<FakeServer>;
export function fakeAnthropic(script: Script): Promise<FakeServer & { told: string[] }>;
export function fakeOpenAI(script: Script): Promise<FakeServer & { told: string[] }>;
