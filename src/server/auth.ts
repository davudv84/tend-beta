import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";

// ---- agent API keys --------------------------------------------------------------------------
// Keys are shown once at creation. Only a SHA-256 hash is stored; they are high-entropy, so no salt is needed.

export const KEY_PREFIX = "tend_sk_";

export function newKey() {
  const key = KEY_PREFIX + randomBytes(24).toString("base64url");
  return { key, hash: hashKey(key), prefix: key.slice(0, KEY_PREFIX.length + 6) };
}

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** The bearer token from an Authorization header, if it looks like a Tend key. */
export function bearer(req: Request) {
  const m = /^Bearer\s+(tend_sk_[A-Za-z0-9_-]{24,64})$/.exec(req.headers.get("authorization")?.trim() ?? "");
  return m?.[1];
}

// ---- the admin token ---------------------------------------------------------------------------
// Operator sessions live on the server (session.ts). The admin token is only ever compared, never stored.

const equal = (a: string, b: string) => {
  const x = createHash("sha256").update(a).digest(), y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
};

export function checkAdminToken(input: string) {
  return !!config.adminToken && equal(input, config.adminToken);
}

export function cookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k !== name) continue;
    try {
      return decodeURIComponent(v.join("="));
    } catch {
      return undefined; // a malformed escape is a bad cookie, not a server error
    }
  }
  return undefined;
}

// ---- viewers ---------------------------------------------------------------------------------

export interface Viewer {
  role: "operator" | "visitor";
  /** Only operators can change anything. */
  canAct: boolean;
  /** Visitors may look around without signing in. */
  public: boolean;
  operatorAvailable: boolean;
  demo: boolean;
}
