// What the sidebar may say about the connection to Tend's server (where the gateway runs), from what is actually known:
// the dashboard's connection status and when it last synced successfully. It never reports "secure" or "protected": those
// claims need verification evidence, and this is only about whether the server is answering.
export type GatewayState = "connected" | "degraded" | "disconnected" | "unknown";

/** How old the last successful sync may be before a live connection is called degraded. */
export const FRESH_MS = 20_000;
/** How long a reconnecting dashboard still counts as degraded rather than disconnected. */
export const GRACE_MS = 30_000;

export function gatewayState(status: "loading" | "live" | "reconnecting" | "signin", syncedAt: number, now: number): GatewayState {
  if (status === "loading" || status === "signin") return "unknown";
  if (status === "reconnecting") return syncedAt && now - syncedAt <= GRACE_MS ? "degraded" : "disconnected";
  if (!syncedAt) return "unknown";
  return now - syncedAt <= FRESH_MS ? "connected" : "degraded";
}
