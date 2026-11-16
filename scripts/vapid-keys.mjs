// Prints a fresh VAPID key pair for browser notifications (push.ts). Put the three lines in the server's environment; keep the private key secret.
// (`npx web-push generate-vapid-keys` makes the same kind of pair; the older TEND_VAPID_* names are still read.)
// A new pair makes every existing browser subscription stop receiving: each person turns notifications on again in Settings.
import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString("base64url")}`);
console.log(`VAPID_PRIVATE_KEY=${ecdh.getPrivateKey().toString("base64url")}`);
console.log("VAPID_SUBJECT=mailto:you@example.com");
