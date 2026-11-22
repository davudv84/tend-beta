#!/usr/bin/env node
// The Content-Security-Policy in a real browser (Chromium): visits the main pages signed out and signed in on a production build, shows a
// toast, opens a menu and a select, and records every CSP violation the browser reports, plus whether styles applied. Any violation is a failure.
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "../../scripts/isolated-server.mjs";

const chromium = (() => { try { return createRequire(import.meta.url)("playwright").chromium; } catch { return undefined; } })();
// On CI a missing browser is a failure, never a silent pass.
if (!chromium) { console.log(process.env.CI ? "FAIL playwright is not installed (required on CI)" : "SKIP playwright is not installed"); process.exit(process.env.CI ? 1 : 0); }
const root = path.resolve(import.meta.dirname, "../..");
const ADMIN = `csp_${randomBytes(24).toString("hex")}`;
const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: mkdtempSync(path.join(tmpdir(), "tend-csp-")) } });
let failed = 0, passed = 0;
const check = (ok, t, ev = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "ok  " : "FAIL"} ${t}${ok ? "" : `  (${ev})`}`); };
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const violations = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to (apply|load|execute)/i.test(m.text())) violations.push(`${page.url()} :: ${m.text().slice(0, 240)}`); });
  page.on("pageerror", (e) => violations.push(`${page.url()} :: pageerror ${e.message.slice(0, 200)}`));
  // cross-origin isolation (COEP require-corp) must not block anything the app itself loads
  const failedLoads = [];
  page.on("requestfailed", (r) => { if (!/net::ERR_ABORTED/.test(r.failure()?.errorText ?? "")) failedLoads.push(`${r.url()} ${r.failure()?.errorText}`); });
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/")) failedLoads.push(`${r.url()} ${r.status()}`); });
  const visit = async (p) => { await page.goto(server.url + p, { waitUntil: "load" }); await page.waitForTimeout(1200); };
  for (const p of ["/", "/welcome", "/account/sign-in", "/account/sign-up", "/developers"]) await visit(p);
  // Dialogs, menus and selects lock the page behind them with a <style> added at run time (react-remove-scroll). It carries the nonce
  // (src/lib/style-nonce.ts); if it were blocked, the page would still scroll behind an open menu. The mobile menu, then a select.
  await page.setViewportSize({ width: 390, height: 844 });
  await visit("/");
  await page.getByRole("button", { name: /menu/i }).first().click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(300);
  const lockedMenu = await page.evaluate(() => document.body.hasAttribute("data-scroll-locked") && getComputedStyle(document.body).overflow === "hidden");
  check(lockedMenu, "an open menu locks the page behind it (the run-time scroll-lock style is allowed by the nonce)");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
  await visit("/design-system");
  await page.getByRole("combobox").first().click();
  await page.getByRole("option").first().waitFor();
  await page.waitForTimeout(300);
  const selectStyled = await page.evaluate(() => { const v = document.querySelector("[data-radix-select-viewport]"); return !!v && getComputedStyle(v).scrollbarWidth === "none"; });
  check(selectStyled, "an open select's own style applied (allowed by its exact hash)");
  await page.keyboard.press("Escape");
  // the page's own stylesheet applied (a blocked <style> would leave the body unstyled)
  const styled = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  check(!!styled && !/^"?Times/i.test(styled), "stylesheet applied (body font is the app's, not the browser default)", styled);
  // signed in as the admin token: the operator pages
  const r = await ctx.request.post(server.url + "/api/operator/session", { data: { token: ADMIN }, headers: { origin: server.url } });
  check(r.ok(), "signed in", String(r.status()));
  for (const p of ["/home", "/agents", "/policies", "/verification", "/settings", "/timeline", "/connect"]) await visit(p);
  // the toast library's own <style> element (allowed by its hash) is active: its rules are in the page's style sheets
  const sonnerRules = await page.evaluate(() => [...document.styleSheets].some((sh) => { try { return [...sh.cssRules].some((r) => r.cssText.includes("data-sonner-toaster")); } catch { return false; } }));
  check(sonnerRules, "the toast library's CSS applied (allowed by its exact hash, not by 'unsafe-inline')");
  check(failedLoads.length === 0, "nothing the app loads was blocked or failed (COEP/CORP)", failedLoads.slice(0, 5).join("\n      "));
  check(violations.length === 0, `no CSP violations on ${14} pages, with a menu and a select opened`, violations.slice(0, 6).join("\n      "));
} finally { await browser.close(); await server.stop(); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
