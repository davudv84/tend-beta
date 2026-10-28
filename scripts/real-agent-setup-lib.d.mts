export interface SetupApi {
  url: string;
  signIn(): Promise<void>;
  state(): Promise<{ projection: { agents: { id: string; name: string; origin: string }[] } }>;
  register(body: object): Promise<{ id: string; apiKey: string }>;
  rotate(id: string): Promise<string>;
  setPolicy(id: string, rules: object[]): Promise<void>;
  policyView(id: string): Promise<{ tools: { tool: string; effect: string; available: boolean }[] }>;
  keyStatus(key: string, url?: string): Promise<number>;
}
export interface SetupFiles { writable(): void; read(): Record<string, string>; write(obj: Record<string, string>): void }
export interface Resolved { key?: string; variable?: string; source?: string; url: string; warnings: string[] }
export interface AgentSpec { name: string; model: string; provider: string; envVar: string }
export function setupAgents(o: { api: SetupApi; files: SetupFiles; resolve: (provider: string) => Resolved; agents: Record<string, AgentSpec>; policy: object[]; wanted: string[]; rotate?: boolean; log?: (s: string) => void }): Promise<{ provider: string; id: string; action: string; prefix: string; verified?: boolean }[]>;
export function checkAgents(o: { api: SetupApi; resolve: (provider: string) => Resolved; agents: Record<string, AgentSpec>; wanted: string[] }): Promise<{ provider: string; ok: boolean; status: number; warnings: string[]; text: string }[]>;
