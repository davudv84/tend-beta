// What the person deciding actually sees (real Chromium, production build): hostile agent-written text in a pending request is shown as text, with
// hidden/direction-changing characters made visible, and nothing executes. Optional screenshot: RT_SHOT=/path.png
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "../../scripts/isolated-server.mjs";
import { record } from "./lib.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const root = path.resolve(import.meta.dirname, "../..");
const ADMIN = `rt_admin_${randomBytes(24).toString("hex")}`;
const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: mkdtempSync(path.join(tmpdir(), "tend-ui-")) } });
const api = async (m, p, { body, cookie, key } = {}) => { const r = await fetch(server.url + p, { method: m, headers: { ...(body && { "content-type": "application/json" }), ...(cookie && { cookie }), ...(key && { authorization: `Bearer ${key}` }) }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null), cookie: r.headers.get("set-cookie")?.split(";")[0] }; };
let browser;
try {
  const cookie = (await api("POST", "/api/operator/session", { body: { token: ADMIN } })).cookie;
  const reg = (await api("POST", "/api/v1/agents", { cookie, body: { name: `<img src=x onerror="window.__x=1">Pay​bot`, model: "m", provider: "Custom" } })).body;
  await api("POST", `/api/v1/agents/${reg.agent.id}/policy`, { cookie, body: { enforcement: "enforce", rules: [{ tool: "wire", action: "send", effect: "approve" }] } });
  const hostile = { amount: 5000, to: "ops@example.com‮gro.live", memo: "line1\nline2​<script>window.__x=2</script>", note: "Ａㅤ".repeat(5) };
  const ask = await api("POST", "/api/v1/authorizations", { key: reg.apiKey, body: { tool: "wire", action: "send", resource: "ACC-1", detail: "EUR 1.00 to Supplier", args: hostile } });
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1500 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: "tend_operator", value: cookie.split("=")[1], url: server.url }]);
  const page = await ctx.newPage(); const dialogs = []; page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto(server.url + "/home", { waitUntil: "networkidle", timeout: 60_000 }); await page.waitForTimeout(1500);
  const seen = await page.evaluate(() => ({ text: document.body.innerText, xss: window.__x ?? null, injected: document.querySelectorAll("img[src='x'], script:not([src])[data-x]").length, raw: /[‮​ㅤ]/.test(document.body.textContent) }));
  if (process.env.RT_SHOT) await page.screenshot({ path: process.env.RT_SHOT });
  record("UI-1", "approval-ui", "the pending request card lists the arguments, shows hidden characters as <U+XXXX>, executes nothing, and contains no raw direction/zero-width characters", ask.status === 201 && seen.text.includes("<U+202E>") && seen.text.includes("<U+200B>") && seen.text.includes("amount: 5000") && !seen.raw && seen.xss === null && !dialogs.length && !seen.injected ? "HELD" : "BROKEN", `ask=${ask.status} U+202E=${seen.text.includes("<U+202E>")} amount=${seen.text.includes("amount: 5000")} raw=${seen.raw} xss=${seen.xss} dialogs=${dialogs.length}`);
} finally { await browser?.close(); await server.stop(); }
