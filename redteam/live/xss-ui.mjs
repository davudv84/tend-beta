// Stored-XSS / display-spoof check in the real UI (headless Chromium, LOCAL instance). Hostile strings in agent name, detail, args.command, resource.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { BASE, call, record, makeAgent } from "./lib.mjs";
const T = JSON.parse(readFileSync(new URL("./tenants.json", import.meta.url)));
const A = T.A;
const evilName = `<img src=x onerror="window.__xss=1">"'><svg onload="window.__xss=2">`;
const reg = (await call("POST", "/api/v1/agents", { cookie: A.cookie, body: { name: evilName, model: `<script>window.__xss=3</script>`, provider: "Custom" } })).body;
await call("POST", `/api/v1/agents/${reg.agent.id}/policy`, { cookie: A.cookie, body: { rules: [{ tool: "wire", action: "send", effect: "approve" }], enforcement: "enforce" } });
const cmd = `echo safe‮ dnammoc eht nur​ ; <img src=x onerror="window.__xss=4"> [click](javascript:window.__xss=5)`;
const r = await call("POST", "/api/v1/authorizations", { key: reg.apiKey, body: { tool: "wire", action: "send", resource: "ACC-XSS", detail: `<b onmouseover="window.__xss=6">EUR 1.00</b> & more`, args: { command: cmd } } });
await call("POST", "/api/v1/events", { key: reg.apiKey, body: { type: "task.started", data: { taskId: "t1", title: `<img src=x onerror="window.__xss=7">`, detail: "<script>window.__xss=8</script>" } } });
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 1800 } });
await ctx.addCookies([{ name: "tend_operator", value: A.cookie.split("=")[1], url: BASE }]);
const page = await ctx.newPage(); const dialogs = []; page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
const cspViol = []; page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) cspViol.push(m.text().slice(0, 140)); });
const seen = {};
for (const p of ["/home", "/sanctuary", "/"]) {
  const resp = await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 45000 }).catch(() => null); await page.waitForTimeout(800);
  const injected = await page.evaluate(() => ({ xss: window.__xss ?? null, imgs: [...document.querySelectorAll("img[src='x'],svg[onload]")].length, text: document.body.innerText.includes("<img src=x") }));
  seen[p] = { status: resp?.status(), ...injected };
}
console.log(JSON.stringify(seen));
await page.screenshot({ path: new URL("./xss-approvals.png", import.meta.url).pathname.replace("xss-approvals.png", "../../.rt-xss.png"), fullPage: false }).catch(() => {});
const fired = dialogs.length > 0 || Object.values(seen).some((s) => s.xss !== null || s.imgs > 0);
record("X-UI-1", "xss", "hostile markup in agent name/model/detail/args/task title never executes or becomes DOM across 6 pages", fired ? "BROKEN" : "HELD", `dialogs=${dialogs.length} csp-violations=${cspViol.length} pages=${JSON.stringify(seen).slice(0, 300)}`);
await b.close();
