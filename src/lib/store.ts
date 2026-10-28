import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CheckInPayload } from "./contract.ts";
import { applyEvents, emptyProjection, type Projection, type WireEvent } from "./projection.ts";
import type { PolicyView, RuleLike } from "./permissions.ts";
import type { IntegrationStatus } from "./integrations.ts";
import type { VerificationRun } from "./verification.ts";
import type { Provider } from "./types";

// The browser holds a read model of the server's event log: a snapshot, then new events by sequence number.
// Nothing here invents activity, and no action reports success until the server has confirmed it.

export type LightPref = "auto" | "dawn" | "day" | "dusk" | "night";
export interface Prefs {
  light: LightPref;
  lowPower: boolean;
  /** The welcome introduction was finished or skipped. */
  welcomeDone: boolean;
  /** The live tour of the world was finished or skipped. */
  introDone: boolean;
}

export interface Viewer {
  role: "operator" | "visitor";
  canAct: boolean;
  public: boolean;
  operatorAvailable: boolean;
  demo: boolean;
}

/** `code` is the server's error code (or "network"); the interface translates it, `error` is the fallback. */
type Failure = { ok: false; error: string; code?: string; status?: number; errors?: string[] };
export type Result = { ok: true } | Failure;

interface Store extends Projection {
  /** False until the first snapshot (or a definitive answer) arrives. */
  ready: boolean;
  status: "loading" | "live" | "reconnecting" | "signin";
  viewer: Viewer | null;
  seq: number;
  /** Server clock minus browser clock, for presence. */
  skew: number;
  /** When the last snapshot or poll succeeded (browser clock). */
  syncedAt: number;
  keys: Record<string, string>;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  init: () => Promise<void>;
  poll: () => Promise<void>;
  signIn: (token: string) => Promise<Result>;
  signOut: () => Promise<void>;
  /** The live sessions and recent sign-in activity (operators only). */
  getSessions: () => Promise<{ ok: true; data: SessionOverview } | Failure>;
  /** Ends every session, this one included, on the server, then returns to the signed-out state. */
  signOutEverywhere: () => Promise<{ ok: true; revoked: number } | Failure>;
  decide: (reviewId: string, status: "approved" | "rejected" | "acknowledged", note?: string) => Promise<Result>;
  setPaused: (agentId: string, paused: boolean) => Promise<Result>;
  setIntegration: (agentId: string, enabled: boolean) => Promise<Result>;
  requestCheckIn: (agentId: string) => Promise<Result>;
  registerAgent: (input: { name: string; model: string; provider: Provider; role?: string; description?: string; public?: boolean }) => Promise<{ ok: true; apiKey: string; agentId: string } | Failure>;
  rotateKey: (agentId: string) => Promise<{ ok: true; apiKey: string } | Failure>;
  revokeKey: (agentId: string) => Promise<{ ok: true } | Failure>;
  /** The server's saved policy for an agent (operators only). Never cached: the screen asks again after every save. */
  getPolicy: (agentId: string) => Promise<{ ok: true; data: PolicyView } | Failure>;
  savePolicy: (agentId: string, input: { rules: RuleLike[]; expectedVersion: number }) => Promise<Result>;
  /** The latest protection checks (operators only), and running them now. Results are never cached here. */
  /** Sandbox setup, registered OpenAI/Anthropic agents and their gateway activity, from the server's records (operators only). */
  getIntegrations: () => Promise<{ ok: true; data: IntegrationStatus } | Failure>;
  getVerification: (agentId: string) => Promise<{ ok: true; data: { run: VerificationRun | null } } | Failure>;
  runVerification: (agentId: string) => Promise<{ ok: true; data: { run: VerificationRun } } | Failure>;
  composeCheckIn: (p: CheckInPayload) => Promise<{ ok: true; id: string } | Failure>;
  resetDemo: () => Promise<Result>;
}

export interface SessionOverview {
  sessions: { id: string; createdAt: number; lastSeenAt: number | null; expiresAt: number; client: string | null; current: boolean }[];
  recent: { at: number; type: string; sessionId: string | null; client: string | null; reason: string | null }[];
}

async function call<T = Record<string, unknown>>(path: string, body?: unknown, method = "POST"): Promise<{ ok: true; data: T } | Failure> {
  try {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.message ?? "", code: data.error, status: res.status, errors: data.errors };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Couldn’t reach the Tend server.", code: "network" };
  }
}

let polling = false;

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      /** After a confirmed change, pull the resulting events so the UI shows exactly what the server stored. */
      const confirmed = async <T,>(r: { ok: true; data: T } | Failure) => {
        if (r.ok) await get().poll();
        return r;
      };
      const fresh = () => ({ ready: false, status: "loading" as const, seq: 0, ...emptyProjection() });
      return {
        ...emptyProjection(),
        ready: false,
        status: "loading",
        viewer: null,
        seq: 0,
        skew: 0,
        syncedAt: 0,
        keys: {},
        prefs: { light: "auto", lowPower: false, welcomeDone: false, introDone: false },

        setPrefs: (p) => set((s) => ({ prefs: { ...s.prefs, ...p } })),

        init: async () => {
          try {
            for (const k of ["tend-demo-v1", "tend-demo-v2"]) localStorage.removeItem(k);
          } catch {}
          try {
            const res = await fetch("/api/v1/state", { credentials: "same-origin" });
            if (res.status === 401) {
              const s = await call<{ viewer: Viewer }>("/api/operator/session", undefined, "GET");
              set({ ...emptyProjection(), ready: true, status: "signin", viewer: s.ok ? s.data.viewer : null });
              return;
            }
            if (!res.ok) throw new Error(String(res.status));
            const snap = (await res.json()) as { viewer: Viewer; seq: number; now: number; projection: Projection; keys?: Record<string, string> };
            set({ ...snap.projection, viewer: snap.viewer, seq: snap.seq, skew: snap.now - Date.now(), syncedAt: Date.now(), keys: snap.keys ?? {}, ready: true, status: "live" });
          } catch {
            set({ status: "reconnecting" });
          }
        },

        poll: async () => {
          if (polling || get().status === "signin") return;
          if (!get().ready) return get().init();
          polling = true;
          try {
            for (let more = true; more; ) {
              type Batch = { seq: number; more: boolean; now: number; events: WireEvent[]; presence: Record<string, { lastSeenAt: number | null; disconnectedAt: number | null }> };
              const r = await call<Batch>(`/api/v1/events?since=${get().seq}`, undefined, "GET");
              if (!r.ok) {
                set({ status: "reconnecting" });
                return;
              }
              more = r.data.more;
              set((s) => {
                const p = applyEvents(s, r.data.events);
                let changed = false;
                const agents = p.agents.map((a) => {
                  const pr = r.data.presence[a.id];
                  if (!pr || (pr.lastSeenAt === (a.lastSeenAt ?? null) && pr.disconnectedAt === (a.disconnectedAt ?? null))) return a;
                  changed = true;
                  return { ...a, lastSeenAt: pr.lastSeenAt ?? undefined, disconnectedAt: pr.disconnectedAt ?? undefined };
                });
                return { ...p, agents: changed ? agents : p.agents, seq: r.data.seq, skew: r.data.now - Date.now(), syncedAt: Date.now(), status: "live" };
              });
            }
          } finally {
            polling = false;
          }
        },

        signIn: async (token) => {
          const r = await call("/api/operator/session", { token });
          if (!r.ok) return r;
          // The server said yes. Before changing anything on screen, ask whether this browser actually holds the session now. Safari drops a
          // Secure cookie on plain http://; resetting the store first would swap the form for a loading skeleton and remount it, losing the
          // typed token and any message, which looked like a dead page. Checked here, the form stays and can say what happened.
          const check = await call<{ viewer?: Viewer }>("/api/operator/session", undefined, "GET");
          if (!check.ok || check.data.viewer?.role !== "operator") return { ok: false, error: "", code: "session_not_kept", status: 200 };
          set(fresh());
          await get().init();
          return { ok: true };
        },

        signOut: async () => {
          await call("/api/operator/session", undefined, "DELETE");
          set(fresh());
          await get().init();
        },

        getSessions: () => call<SessionOverview>("/api/operator/sessions", undefined, "GET"),

        signOutEverywhere: async () => {
          const r = await call<{ revoked: number }>("/api/operator/sessions", undefined, "DELETE");
          if (!r.ok) return r;
          set(fresh());
          await get().init();
          return { ok: true, revoked: r.data.revoked };
        },

        decide: async (id, status, note) => confirmed(await call(`/api/v1/reviews/${encodeURIComponent(id)}`, { status, note })),
        setPaused: async (id, paused) => confirmed(await call(`/api/v1/agents/${encodeURIComponent(id)}/control`, { action: paused ? "pause" : "resume" })),
        setIntegration: async (id, enabled) => confirmed(await call(`/api/v1/agents/${encodeURIComponent(id)}/control`, { action: enabled ? "enable" : "disable" })),
        requestCheckIn: async (id) => confirmed(await call(`/api/v1/agents/${encodeURIComponent(id)}/check-in-requests`)),

        resetDemo: async () => {
          const r = await call("/api/v1/demo/reset");
          if (r.ok) {
            set(fresh());
            await get().init();
          }
          return r;
        },

        registerAgent: async (input) => {
          const r = await call<{ apiKey: string; agent: { id: string } }>("/api/v1/agents", input);
          if (!r.ok) return r;
          // A new agent changes the snapshot (and key list), so reload it. The snapshot replaces what is held, and the page stays
          // up (resetting to "not ready" would unmount whoever is showing the key, which is shown only once).
          await get().init();
          return { ok: true, apiKey: r.data.apiKey, agentId: r.data.agent.id };
        },

        getPolicy: async (id) => call<PolicyView>(`/api/v1/agents/${encodeURIComponent(id)}/policy`, undefined, "GET"),
        // Saving always switches the agent to enforce: a policy that only monitors would not be what the owner just chose.
        savePolicy: async (id, { rules, expectedVersion }) => confirmed(await call(`/api/v1/agents/${encodeURIComponent(id)}/policy`, { rules, enforcement: "enforce", expectedVersion })),

        getIntegrations: async () => call<IntegrationStatus>("/api/v1/integrations/status", undefined, "GET"),

        getVerification: async (id) => call<{ run: VerificationRun | null }>(`/api/v1/agents/${encodeURIComponent(id)}/verification`, undefined, "GET"),
        runVerification: async (id) => call<{ run: VerificationRun }>(`/api/v1/agents/${encodeURIComponent(id)}/verification`),

        rotateKey: async (id) => {
          const r = await confirmed(await call<{ apiKey: string; prefix: string }>(`/api/v1/agents/${encodeURIComponent(id)}/keys`));
          if (!r.ok) return r;
          set((s) => ({ keys: { ...s.keys, [id]: r.data.prefix } }));
          return { ok: true, apiKey: r.data.apiKey };
        },

        revokeKey: async (id) => {
          const r = await confirmed(await call(`/api/v1/agents/${encodeURIComponent(id)}/keys`, undefined, "DELETE"));
          if (!r.ok) return r;
          set((s) => ({ keys: Object.fromEntries(Object.entries(s.keys).filter(([k]) => k !== id)) }));
          return { ok: true };
        },

        composeCheckIn: async (p) => {
          const r = await confirmed(await call<{ id: string }>("/api/v1/demo/check-ins", p));
          return r.ok ? { ok: true, id: r.data.id } : r;
        },
      };
    },
    // Only viewer preferences live in the browser; all agent data comes from the server.
    { name: "tend-prefs", partialize: ({ prefs }) => ({ prefs }) },
  ),
);

export const useAgent = (id: string) => useStore((s) => s.agents.find((a) => a.id === id));
