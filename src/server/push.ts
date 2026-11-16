// The Web Push protocol itself, with Node's own crypto and no extra dependency: the payload is encrypted for the browser (RFC 8291,
// aes128gcm) and the request is signed with this server's VAPID key (RFC 8292). Without the VAPID settings (config.vapid) nothing is sent
// and the app says so; the notifications inside TEND work either way.
//
// What is sent, to whom and when is the notifier's business (notify/, channel notify/channels/web-push.ts). This file only knows how.
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";
import { config } from "./config.ts";

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
