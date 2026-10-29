// Sending mail: verification, password reset, approval. Resend's HTTPS API when RESEND_API_KEY is set (no SDK). Without a key, and only
// outside production, a mail is written to a local outbox folder instead, so the whole flow can be tried on one machine; a production
// server without a key sends nothing and accounts stay off (config.accounts). The key is only ever sent to Resend, and never logged.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.ts";

export interface Mail { to: string; subject: string; text: string }
export type Send = (mail: Mail) => Promise<void>;

export const sendMail: Send = async (mail) => {
  if (config.mailKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.mailKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.mailFrom, to: [mail.to], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`mail service answered ${res.status}`);
    return;
  }
  if (process.env.NODE_ENV === "production" && !config.localHttp) throw new Error("no mail service configured (RESEND_API_KEY)");
  const dir = path.join(config.dataDir, "outbox");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${mail.to.replace(/[^a-z0-9@._-]/gi, "_")}.txt`);
  writeFileSync(file, `To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`, { mode: 0o600 });
  console.log(`[tend] development mail to ${mail.to} written to ${file}`);
};
