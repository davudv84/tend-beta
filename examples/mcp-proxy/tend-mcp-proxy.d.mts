import type { ChildProcess } from "node:child_process";
import type { Gate } from "../claude-quickstart/tend-client.mjs";
export function toRequest(params: unknown): { tool: string; action: string; resource: string; detail: string } | null;
export function blocked(id: unknown, why: string): { jsonrpc: "2.0"; id: unknown; result: { content: { type: "text"; text: string }[]; isError: true } };
export function startProxy(o: { command: string; args: string[]; gate: Gate; input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream; env?: Record<string, string | undefined> }): ChildProcess;
