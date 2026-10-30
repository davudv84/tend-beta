// The notification list as the server has it, and this browser's push subscription. Nothing is marked read or subscribed on screen until
// the server confirmed it. Browser permission is only ever requested from enablePush, which must be called from a person's click.
import { create } from "zustand";
import { call } from "./store";

export type NotificationKind = "approval" | "blocked" | "alert" | "failed" | "expired" | "test";
export interface NotificationItem {
  id: string; kind: NotificationKind; agentId: string | null; agentName: string | null; tool: string | null; action: string | null;
  status: string | null; count: number; createdAt: number; updatedAt: number; read: boolean; resolved: boolean; href: string;
}
export interface PushServer { configured: boolean; publicKey: string | null; subscriptions: number; account: boolean }

interface State {
  items: NotificationItem[];
  unread: number;
  push: PushServer | null;
  loaded: boolean;
  /** False once the server said this viewer cannot read notifications (signed out): polling stops until a refresh succeeds. */
  allowed: boolean;
  refresh: () => Promise<void>;
  markRead: (ids: string[] | "all") => Promise<boolean>;
}

let inflight: Promise<void> | null = null;

export const useNotifications = create<State>()((set, get) => ({
  items: [],
  unread: 0,
  push: null,
  loaded: false,
  allowed: true,
  refresh: () => (inflight ??= (async () => {
    try {
      const r = await call<{ items: NotificationItem[]; unread: number; push: PushServer }>("/api/v1/notifications", undefined, "GET");
      if (r.ok) set({ items: r.data.items, unread: r.data.unread, push: r.data.push, loaded: true, allowed: true });
      else if (r.status === 401 || r.status === 403) set({ items: [], unread: 0, loaded: true, allowed: false });
    } finally {
      inflight = null;
    }
  })()),
  markRead: async (ids) => {
    if (ids !== "all" && ids.length === 0) return true;
    const r = await call("/api/v1/notifications/read", ids === "all" ? { all: true } : { ids });
    await get().refresh();
    return r.ok;
  },
}));

// ---- browser push ------------------------------------------------------------------------------------

export type PushSupport = "supported" | "unsupported" | "insecure";

/** Whether this browser can receive push at all. Plain http (other than localhost) is never a secure context, so it cannot. */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "supported";
}

export const permissionState = (): NotificationPermission | "unsupported" => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

const keyBytes = (b64url: string) => {
  const raw = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

async function existing() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Whether this browser currently receives this account's notifications, according to the server. */
export async function thisBrowserSubscribed() {
  if (pushSupport() !== "supported" || permissionState() !== "granted") return false;
  const sub = await existing().catch(() => null);
  if (!sub) return false;
  const r = await call<{ subscribed: boolean }>("/api/v1/notifications/subscriptions", { check: sub.endpoint });
  return r.ok && r.data.subscribed;
}

export type EnableResult = { ok: true } | { ok: false; reason: "unsupported" | "insecure" | "denied" | "dismissed" | "not_configured" | "failed"; code?: string; error?: string };

/** Asks for permission, subscribes this browser and registers it with the server. Call it only from a click. */
export async function enablePush(publicKey: string | null, locale: string): Promise<EnableResult> {
  const support = pushSupport();
  if (support !== "supported") return { ok: false, reason: support };
  if (!publicKey) return { ok: false, reason: "not_configured" };
  const permission = await Notification.requestPermission();
  if (permission === "denied") return { ok: false, reason: "denied" };
  if (permission !== "granted") return { ok: false, reason: "dismissed" };
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const key = keyBytes(publicKey);
    let sub = await reg.pushManager.getSubscription();
    // A subscription made for another server key cannot receive this server's messages.
    if (sub && !sameKey(sub.options.applicationServerKey, key)) { await sub.unsubscribe(); sub = null; }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const j = sub.toJSON();
    const r = await call("/api/v1/notifications/subscriptions", { endpoint: j.endpoint, keys: j.keys, locale });
    if (!r.ok) {
      await sub.unsubscribe().catch(() => {});
      return { ok: false, reason: r.code === "push_not_configured" ? "not_configured" : "failed", code: r.code, error: r.error };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "failed", error: (e as Error).message };
  }
}

/** Stops notifications to this browser: the server forgets it first, then the browser drops the subscription. */
export async function disablePush() {
  const sub = await existing().catch(() => null);
  if (!sub) return true;
  const r = await call("/api/v1/notifications/subscriptions", { endpoint: sub.endpoint }, "DELETE");
  if (!r.ok) return false;
  await sub.unsubscribe().catch(() => {});
  return true;
}
