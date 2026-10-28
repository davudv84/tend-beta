#!/usr/bin/env node
// Real-browser test of operator sign-in and approval, in WebKit (Safari's engine) and Chromium, against isolated TEND servers.
//
//   npm run build
//   npm i --no-save playwright-core && npx playwright-core install webkit chromium      (once; not a project dependency)
//   npm run e2e:browser
//
// Why it exists: a production build over plain http:// issues a `Secure` session cookie, which Safari refuses to keep. The token was accepted, the
// cookie dropped and the sign-in form came back (and, before the fix, wiped itself), so the page looked dead. This checks, in a real engine:
//   1. a local server (TEND_LOCAL_HTTP=1, what agents:try uses): sign-in sticks on 127.0.0.1 and localhost, in WebKit and Chromium;
//   2. a strict server (production cookies): WebKit drops the cookie and the page SAYS so, keeping what was typed; Chromium signs in;
//   3. the approval workflow through the real UI: approve runs once with exactly the approved text, reject never runs.
// Skipped (exit 0, clearly) if playwright-core or a browser is missing. It starts and stops its own servers with fake tokens.
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "./isolated-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
let pw;
try {
  pw = await import("playwright-core");
} catch {
  console.log("SKIPPED: playwright-core is not installed. Run: npm i --no-save playwright-core && npx playwright-core install webkit chromium");
  process.exit(0);
}
const engines = {};
for (const name of ["webkit", "chromium"]) {
  const exe = pw[name].executablePath();
  if (exe && existsSync(exe)) engines[name] = pw[name];
}
if (!engines.webkit) {
  console.log("SKIPPED: WebKit is not installed. Run: npx playwright-core install webkit");
  process.exit(0);
}

// A hung browser must fail the run, not hang it.
setTimeout(() => {
  console.error("FAIL  browser e2e exceeded its 6 minute limit");
  process.exit(1);
}, 6 * 60_000).unref();

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, String(e.message).split("\n")[0]]);
  }
};
const expect = (c, m) => {
  if (!c) throw new Error(m);
};

async function withServer(extra, fn) {
  const token = `fake_admin_${randomBytes(18).toString("hex")}`;
  const data = mkdtempSync(path.join(tmpdir(), "tend-browser-db-")), sandbox = mkdtempSync(path.join(tmpdir(), "tend-browser-sb-"));
  const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: token, TEND_DATA_DIR: data, TEND_GATEWAY_SANDBOX_DIR: sandbox, ...extra } });
  try {
    await fn({ url: server.url, token, sandbox });
  } finally {
    await server.stop();
    rmSync(data, { recursive: true, force: true });
    rmSync(sandbox, { recursive: true, force: true });
  }
}

async function signInAttempt(engine, base, token) {
  const browser = await engine.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
    await page.goto(`${base}/operator`, { waitUntil: "domcontentloaded" });
    await page.locator("input[type=password]").waitFor();
    await page.waitForFunction(() => { const i = document.querySelector("input[type=password]"); return i && Object.keys(i).some((k) => k.startsWith("__react")); }, null, { timeout: 15000 }); // hydrated
    await page.locator("input[type=password]").click();
    await page.keyboard.type(token, { delay: 3 });
    await page.getByRole("button", { name: /sign in/i }).last().click();
    await page.waitForTimeout(2500);
    const main = await page.locator("main").innerText();
    return { signedIn: /signed in as an operator/i.test(main), cookies: (await page.context().cookies()).length, alert: (await page.locator("main [role=alert]").first().textContent().catch(() => "")) ?? "", typedKept: (await page.locator("input[type=password]").inputValue().catch(() => "")).length > 0, errors, page, browser };
  } catch (e) {
    await browser.close();
    throw e;
  }
}

try {
  await withServer({}, async ({ url, token, sandbox }) => {
    for (const [name, engine] of Object.entries(engines))
      for (const host of ["127.0.0.1", "localhost"])
        await step(`local server (TEND_LOCAL_HTTP): ${name} signs in on ${host} and keeps the session`, async () => {
          const r = await signInAttempt(engine, url.replace("127.0.0.1", host), token);
          await r.browser.close();
          expect(r.signedIn && r.cookies === 1, `signed in: ${r.signedIn}, cookies kept: ${r.cookies}`);
          expect(r.errors.length === 0, `page errors: ${r.errors}`);
        });

    for (const [name, engine] of Object.entries(engines))
      await step(`approval workflow in ${name}: approve writes exactly the approved text once; reject never runs; a replay is refused`, async () => {
        const op = async (m, p, b) => fetch(url + p, { method: m, headers: { cookie, "content-type": "application/json" }, body: b && JSON.stringify(b) }).then((r) => r.json());
        const login = await fetch(`${url}/api/operator/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
        const cookie = login.headers.get("set-cookie").split(";")[0];
        const reg = await op("POST", "/api/v1/agents", { name: `Browser ${name}`, model: "m", provider: "OpenAI" });
        await op("POST", `/api/v1/agents/${reg.agent.id}/policy`, { rules: [{ tool: "write_test_file", action: "create", effect: "approve" }], enforcement: "enforce" });
        const agent = (m, p, b) => fetch(url + p, { method: m, headers: { authorization: `Bearer ${reg.apiKey}`, "content-type": "application/json" }, body: b && JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() }));
        const yes = `approved-${name}.txt`, no = `rejected-${name}.txt`;
        const ask = async (f, text) => (await agent("POST", "/api/v1/gateway/requests", { tool: "write_test_file", params: { path: f, text } })).body;
        const a1 = await ask(yes, `approved in ${name}`), a2 = await ask(no, `never (${name})`);
        expect(a1.status === "pending" && a2.status === "pending", "both requests should wait");
        const s = await signInAttempt(engine, url, token);
        try {
          expect(s.signedIn, "sign-in failed");
          await s.page.getByRole("link", { name: "Approvals" }).first().click();
          await s.page.getByText(yes).first().waitFor({ timeout: 10000 });
          const card = (f) => s.page.locator("section, article, div").filter({ hasText: f }).filter({ has: s.page.getByRole("button", { name: /allow once/i }) }).last();
          expect(!existsSync(path.join(sandbox, yes)), "the file existed before approval");
          await card(yes).getByRole("button", { name: /allow once/i }).click();
          await s.page.waitForTimeout(1200);
          await card(no).getByRole("button", { name: /don.?t allow/i }).click();
          await s.page.waitForTimeout(1200);
        } finally {
          await s.browser.close();
        }
        const c1 = await agent("POST", `/api/v1/authorizations/${a1.id}/token`, {});
        const body = { authorizationId: a1.id, token: c1.body.token, tool: "write_test_file", params: { path: yes, text: `approved in ${name}` } };
        expect(c1.status === 200 && (await agent("POST", "/api/v1/gateway/execute", body)).status === 200, "the approved write did not run");
        expect(readFileSync(path.join(sandbox, yes), "utf8") === `approved in ${name}\n`, "the file is not exactly what was approved");
        expect((await agent("POST", "/api/v1/gateway/execute", body)).status === 409, "a replay was not refused");
        expect((await agent("POST", `/api/v1/authorizations/${a2.id}/token`, {})).status === 403 && !existsSync(path.join(sandbox, no)), "a rejected write must never run");
      });
  });

  await withServer({ TEND_LOCAL_HTTP: "0" }, async ({ url, token }) => {
    await step("strict server (production cookies, plain http): WebKit drops the cookie, and the page says so and keeps what was typed", async () => {
      const r = await signInAttempt(engines.webkit, url, token);
      await r.browser.close();
      expect(!r.signedIn && r.cookies === 0, `expected WebKit to drop the Secure cookie (signedIn ${r.signedIn}, cookies ${r.cookies})`);
      expect(/did not keep the sign-in/i.test(r.alert), `no explanation shown: "${r.alert}"`);
      expect(r.typedKept, "the typed token was wiped, which made the page look dead");
    });
    if (engines.chromium)
      await step("strict server: Chromium (which accepts Secure cookies on loopback) still signs in", async () => {
        const r = await signInAttempt(engines.chromium, url, token);
        await r.browser.close();
        expect(r.signedIn, "Chromium should sign in");
      });
  });
} catch (e) {
  results.push(["FAIL", "harness", e.message]);
}
for (const [s, name, why] of results) console.log(`${s}  ${name}${why ? `\n      ${why}` : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed} passed, ${failed} failed (engines: ${Object.keys(engines).join(", ")})`);
process.exit(failed ? 1 : 0);
