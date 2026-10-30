// Web Push: the encryption is checked against the published example in RFC 8291 (Appendix A and Section 5), the VAPID signature against the
// public key, and delivery against a local stand-in push service that decrypts what it receives with the subscription's private key.
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { encrypt, flushPush, newVapidKeys, vapidHeader } from "./push.ts";
import { memoryDb } from "./db.ts";
import { createTestNotification, saveSubscription } from "./notifications.ts";

const u = (s: string) => Buffer.from(s, "base64url");

test("encryption matches the RFC 8291 example byte for byte", () => {
  const body = encrypt(Buffer.from("When I grow up, I want to be a watermelon"),
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", "BTBZMqHH6r4Tts7J_aSIgg",
    { serverPrivate: u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), salt: u("DGv6ra1nlYgDCS1FRnbzlw") });
  assert.equal(body.toString("base64url"),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" + "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" + "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
  assert.equal(body.subarray(86).toString("base64url"), "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ", "the record alone, as Appendix A gives it");
});

/** What a browser does with a message: the receiving side of RFC 8291. */
function decrypt(body: Buffer, uaPrivate: Buffer, auth: Buffer) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), record = body.subarray(21 + idlen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const ua = ecdh.getPublicKey();
  const ikm = Buffer.from(hkdfSync("sha256", ecdh.computeSecret(asPublic), auth, Buffer.concat([Buffer.from("WebPush: info\0"), ua, asPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, "a single, final record");
  return plain.subarray(0, -1).toString();
}

function withVapid<T>(fn: (keys: ReturnType<typeof newVapidKeys>) => Promise<T>) {
  const keys = newVapidKeys();
  Object.assign(process.env, { TEND_VAPID_PUBLIC_KEY: keys.publicKey, TEND_VAPID_PRIVATE_KEY: keys.privateKey, TEND_VAPID_SUBJECT: "mailto:ops@example.com", TEND_PUSH_TEST_ENDPOINTS: "loopback" });
  return fn(keys).finally(() => { for (const k of ["TEND_VAPID_PUBLIC_KEY", "TEND_VAPID_PRIVATE_KEY", "TEND_VAPID_SUBJECT", "TEND_PUSH_TEST_ENDPOINTS"]) delete process.env[k]; });
}

test("the VAPID header is an ES256 token for the push service's origin, verifiable with the advertised key", () => withVapid(async (keys) => {
  const h = vapidHeader("https://fcm.googleapis.com/fcm/send/abc", 1_700_000_000_000);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
  assert.ok(m, h);
  assert.equal(m[4], keys.publicKey);
  const claims = JSON.parse(u(m[2]).toString());
  assert.deepEqual(claims, { aud: "https://fcm.googleapis.com", exp: 1_700_000_000 + 12 * 3600, sub: "mailto:ops@example.com" });
  const pub = u(keys.publicKey);
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: "ieee-p1363" }, u(m[3])));
}));

test("a queued notification is delivered once, encrypted for the browser, with fixed text and a path; a gone browser is forgotten", () => withVapid(async (keys) => {
  const db = await memoryDb();
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = Buffer.alloc(16, 7);
  const got: { headers: Record<string, unknown>; text: string }[] = [];
  let answer = 201;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      got.push({ headers: req.headers, text: decrypt(Buffer.concat(chunks), ecdh.getPrivateKey(), auth) });
      res.statusCode = answer;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/push/one`;
  try {
    await db.run("INSERT INTO workspaces (id, name, created_at) VALUES ('w1', 'W1', 0)");
    await db.run("INSERT INTO users (id, email, password_hash, workspace_id, created_at, password_changed_at) VALUES ('u1', 'a@example.com', 'x', 'w1', 0, 0)");
    await saveSubscription(db, "u1", { endpoint, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") }, locale: "de" });
    await db.tx((q) => createTestNotification(q, "w1"));
    assert.deepEqual(await flushPush(db), { configured: true, sent: 1, failed: 0 });
    assert.deepEqual(await flushPush(db), { configured: true, sent: 0, failed: 0 }, "claimed once: a second flush sends nothing");
    assert.equal(got.length, 1);
    const msg = JSON.parse(got[0].text);
    assert.deepEqual(msg.title, "TEND: Testbenachrichtigung", "in the language the browser subscribed with");
    assert.equal(msg.url, "/settings?tab=notifications");
    assert.equal(got[0].headers["content-encoding"], "aes128gcm");
    assert.match(String(got[0].headers.authorization), new RegExp(`^vapid t=.+, k=${keys.publicKey}$`));
    // The browser unsubscribed: the push service answers 410 and the subscription is removed.
    answer = 410;
    await db.tx((q) => createTestNotification(q, "w1"));
    await flushPush(db);
    assert.equal((await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM push_subscriptions"))!.n, 0);
  } finally {
    server.close();
    await db.close();
  }
}));
