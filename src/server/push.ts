// Browser notifications over the standard Web Push protocol, with Node's own crypto and no extra dependency: the payload is encrypted
// for the browser (RFC 8291, aes128gcm) and the request is signed with this server's VAPID key (RFC 8292). Without TEND_VAPID_PUBLIC_KEY,
// TEND_VAPID_PRIVATE_KEY and TEND_VAPID_SUBJECT nothing is sent and the app says so; the notifications inside TEND work either way.
//
// What a browser notification says is fixed text per kind ("An agent is waiting for your decision") and a path on this site. Never an agent
// name, a tool, its arguments or anything from an event: a lock screen is not a place for them. Opening it goes to the page, which asks
// for a session as always.
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";
import { DICTS } from "../i18n/index.ts";
import { config } from "./config.ts";
import type { DB } from "./db.ts";
import { hrefOf, type Kind } from "./notifications.ts";

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");
const RECORD_SIZE = 4096;

/** RFC 8291 message encryption. `serverPrivate` and `salt` exist for the RFC's test vector; real messages use fresh ones every time. */
export function encrypt(payload: Buffer, p256dh: string, authSecret: string, fixed: { serverPrivate?: Buffer; salt?: Buffer } = {}) {
  const ua = unb64(p256dh), auth = unb64(authSecret);
  if (ua.length !== 65 || ua[0] !== 4 || auth.length !== 16) throw new Error("malformed subscription keys");
  if (payload.length > RECORD_SIZE - 17 - 86) throw new Error("payload too large");
  const ecdh = createECDH("prime256v1");
  if (fixed.serverPrivate) ecdh.setPrivateKey(fixed.serverPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(ua);
  const salt = fixed.salt ?? randomBytes(16);
  const ikm = Buffer.from(hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), ua, asPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const record = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, record]);
}

/** The Authorization header for one push service (RFC 8292): a short-lived ES256 token for its origin, and this server's public key. */
export function vapidHeader(endpoint: string, now = Date.now()) {
  const v = config.vapid;
  if (!v) throw new Error("push is not configured");
  const pub = unb64(v.publicKey);
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: v.privateKey, x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33, 65)) }, format: "jwk" });
  const part = (o: object) => b64(Buffer.from(JSON.stringify(o)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: v.subject })}`;
  const sig = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64(sig)}, k=${v.publicKey}`;
}

/** A fresh VAPID key pair, for setting up a server (scripts/vapid-keys.mjs prints one). */
export function newVapidKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64(ecdh.getPublicKey()), privateKey: b64(ecdh.getPrivateKey()) };
}

interface Sub { id: string; endpoint: string; p256dh: string; auth: string; locale: string; failures: number }
type Result = "sent" | "gone" | "failed";

async function deliver(db: DB, sub: Sub, payload: object, now: number): Promise<Result> {
  let status = 0;
  try {
    const res = await fetch(sub.endpoint, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: { TTL: "3600", Urgency: "high", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", Authorization: vapidHeader(sub.endpoint, now) },
      body: encrypt(Buffer.from(JSON.stringify(payload)), sub.p256dh, sub.auth),
    });
    status = res.status;
  } catch {}
  if (status >= 200 && status < 300) {
    await db.run("UPDATE push_subscriptions SET last_sent_at = ?, failures = 0 WHERE id = ?", now, sub.id);
    return "sent";
  }
  // 404 and 410: the browser unsubscribed or the subscription expired. Five failures in a row: stop trying that browser.
  if (status === 404 || status === 410 || sub.failures + 1 >= 5) {
    await db.run("DELETE FROM push_subscriptions WHERE id = ?", sub.id);
    return "gone";
  }
  await db.run("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?", sub.id);
  console.error(`[tend] a push service refused a notification (${status || "no answer"})`); // never the endpoint: it identifies the browser
  return "failed";
}

const PREF: Record<Kind, string | null> = { approval: "approval", blocked: "blocked", alert: "alert", failed: "alert", expired: null, test: null };

/** The browsers of this workspace's accounts that want this kind. A test goes to every subscribed browser of the workspace. */
async function targets(db: DB, workspace: string, kind: Kind) {
  const pref = PREF[kind];
  return db.all<Sub>(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth, s.locale, s.failures FROM push_subscriptions s JOIN users u ON u.id = s.user_id
     LEFT JOIN notification_prefs p ON p.user_id = u.id
     WHERE u.workspace_id = ? AND u.disabled_at IS NULL ${pref ? `AND COALESCE(p.${pref}, 1) = 1` : ""}`, workspace);
}

/** Only queued notifications this young are sent: a browser notification about an approval that already lapsed is noise. */
export const PUSH_MAX_AGE = 15 * 60_000;

/**
 * Sends what is queued. Each notification is claimed by one atomic update before anything is sent, so two instances (or two requests)
 * never send the same one twice. One that cannot be delivered is not retried: the app still lists it.
 */
export async function flushPush(db: DB, now = Date.now()) {
  if (!config.vapid) {
    await db.run("UPDATE notifications SET push = 'skipped' WHERE push = 'queued'");
    return { configured: false, sent: 0, failed: 0 };
  }
  const claimed = await db.all<{ id: string; workspace_id: string; kind: Kind; subject: string | null; agent_id: string | null; created_at: number }>(
    `UPDATE notifications SET push = 'sending' WHERE id IN (SELECT id FROM notifications WHERE push = 'queued' ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED)
     RETURNING id, workspace_id, kind, subject, agent_id, created_at`);
  let sent = 0, failed = 0;
  for (const n of claimed) {
    let any = false;
    if (n.created_at > now - PUSH_MAX_AGE) {
      for (const sub of await targets(db, n.workspace_id, n.kind)) {
        const text = (DICTS[sub.locale === "de" ? "de" : "en"]).notify.push[n.kind];
        const r = await deliver(db, sub, { title: text.title, body: text.body, url: hrefOf(n.kind, n.subject, n.agent_id), tag: n.id }, now);
        if (r === "sent") { sent++; any = true; } else failed++;
      }
    }
    await db.run("UPDATE notifications SET push = ? WHERE id = ?", any ? "sent" : "skipped", n.id);
  }
  return { configured: true, sent, failed };
}
