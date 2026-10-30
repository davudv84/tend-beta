// Prints a fresh VAPID key pair for browser notifications (push.ts). Put the three lines in the server's environment; keep the private key secret.
// A new pair makes every existing browser subscription stop receiving: each person turns notifications on again in Settings.
import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
console.log(`TEND_VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString("base64url")}`);
console.log(`TEND_VAPID_PRIVATE_KEY=${ecdh.getPrivateKey().toString("base64url")}`);
console.log("TEND_VAPID_SUBJECT=mailto:you@example.com");
