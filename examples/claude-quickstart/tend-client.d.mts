export interface GateResult { executed: boolean; outcome: string; reason?: string; detail?: string; result?: unknown; authorizationId?: string }
export interface Gate {
  run(request: { tool: string; action: string; resource?: string; detail?: string }, execute: (ctx: { authorizationId: string }) => Promise<unknown>, report?: (event: Record<string, unknown>) => Promise<unknown>): Promise<GateResult>;
}
export function connectTend(options?: { url?: string; key?: string; onPending?: (id: string) => unknown; log?: (line: string) => void; retries?: number; pollMs?: number; approvalTimeoutMs?: number }): Gate;
