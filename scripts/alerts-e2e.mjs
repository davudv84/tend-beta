#!/usr/bin/env node
// Alert routing end to end: a production build with TEND_ALERT_WEBHOOK_URL pointing at a receiver on this machine. A burst of failed sign-ins
// must reach the receiver as ONE auth_failures alert, with no address, password or e-mail in it; the server log carries redacted lines.
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "./isolated-server.mjs";

const got = [];
const rx = createServer((q, s) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { got.push(b); s.statusCode = 204; s.end(); }); });
await new Promise((r) => rx.listen(0, "127.0.0.1", r));
const hook = `http://127.0.0.1:${rx.address().port}/tend-alerts`;
const root = path.resolve(import.meta.dirname, "..");
const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: `al_${randomBytes(24).toString("hex")}`, TEND_DATA_DIR: mkdtempSync(path.join(tmpdir(), "tend-alerts-")), TEND_ALERT_WEBHOOK_URL: hook } });
let passed = 0, failed = 0;
const check = (ok, t, ev = "") => { ok ? passed++ : failed++; console.log(`${ok ? "ok  " : "FAIL"} ${t}${ok ? "" : `  (${ev})`}`); };
try {
  const email = `victim-${randomBytes(3).toString("hex")}@example.com`;
  for (let i = 0; i < 30; i++)
    await fetch(server.url + "/api/account/sign-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${i}-${email}`, password: `guess-number-${i}-xyz` }) });
  for (const end = Date.now() + 10_000; Date.now() < end && !got.length; ) await new Promise((r) => setTimeout(r, 200));
  const alerts = got.map((b) => JSON.parse(b));
  check(alerts.filter((a) => a.rule === "auth_failures").length === 1, "30 failed sign-ins → exactly one auth_failures alert delivered to the webhook", JSON.stringify(alerts));
  check(alerts[0]?.severity === "high" && typeof alerts[0]?.summary === "string", "severity and a readable summary");
  check(!got.join("").includes("example.com") && !got.join("").includes("guess-number") && !got.join("").includes("127.0.0.1"), "no e-mail, password or address in the alert");
} catch (e) { failed++; console.log("FAIL harness", e.message); }
finally { await server.stop(); rx.close(); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
