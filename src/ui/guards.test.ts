// The rules of the design, as tests. They read the source because they guard what the code is allowed to do, not how it looks.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_PREFS, parsePrefs, prefsFromCookie } from "./prefs.ts";

const root = path.join(import.meta.dirname, "..", "..");
const src = (f: string) => readFileSync(path.join(root, f), "utf8");

test("no bulk answers: only one request is ever answered by one action, and Home never answers anything itself", () => {
  const card = src("src/ui/request-card.tsx"), view = src("src/app/(next)/home/view.tsx");
  assert.equal(card.match(/\bdecide\(/g)?.length, 1, "exactly one place records an answer");
  assert.match(card, /await decide\(auth\.id, status\)/, "and it answers this card's own request");
  assert.equal(/\bdecide\b/.test(view), false, "the Home screen cannot answer requests, only render the cards that do");
  for (const file of [card, view, src("src/ui/shell.tsx")])
    assert.equal(/approve ?all|allow ?all|answer ?all|select ?all|bulk|Promise\.all\([^)]*decide/i.test(file), false, "no all-at-once answer anywhere");
});

test("the exact content of a request is never inside Details: it comes first, in the card itself", () => {
  const card = src("src/ui/request-card.tsx");
  const content = card.indexOf("<blockquote"), disclosure = card.indexOf("<Disclosure");
  assert.ok(content > 0 && disclosure > content, "the quotation is rendered before, and outside, the disclosure");
  assert.ok(card.indexOf("{sentence}") < disclosure, "so is the sentence saying who asks for what");
  assert.ok(card.indexOf("h.allow") > content && card.indexOf("h.allow") < disclosure, "and so are the answers");
});

test("showing details by default only changes how much is open, never what is available", () => {
  const card = src("src/ui/request-card.tsx"), view = src("src/app/(next)/home/view.tsx"), disclosure = src("src/ui/disclosure.tsx");
  assert.equal(card.match(/prefs\.details/g)?.length, 1);
  assert.match(card, /<Disclosure[^>]*open=\{prefs\.details\}/, "the preference is only the starting state of the disclosure");
  assert.equal(/details/i.test(view.replace(/h\.[a-zA-Z.]*details/g, "")) && /prefs/.test(view), false, "Home logic never branches on the preference");
  assert.equal(/prefs|useUiPrefs/.test(disclosure), false, "the disclosure itself knows nothing about the preference");
  assert.match(disclosure, /chosen \?\? initial/, "and a person's own choice wins over the default");
});

test("status is always a word, never only a colour: At Risk on Home is written out", () => {
  assert.match(src("src/app/(next)/home/view.tsx"), /t\.protection\.status\.at_risk/);
  assert.match(src("src/ui/assistant-status.ts"), /a\.protection\.attention\(/, "and an assistant's line says how many checks need attention");
  for (const f of ["src/ui/assistant-row.tsx", "src/app/(next)/agents/[id]/view.tsx"])
    assert.match(src(f), /assistantStatus\(/, `${f} uses the one wording, so Home, the list and the page always agree`);
});

test("the new look is scoped: screens that have not been redesigned keep theirs", () => {
  const css = src("src/app/globals.css");
  assert.match(css, /--primary: #ece5d6;/, "the original palette is untouched");
  const scoped = css.split(/\n(?=:root|@media)/).filter((b) => /--primary: #2e5e4e|--primary: #8dbba5/.test(b));
  assert.ok(scoped.length >= 2, "light and dark exist");
  for (const block of scoped) assert.match(block, /^(:root:has\(\.ui-next|@media \(prefers-color-scheme: dark\)\s*\{\s*:root:has\(\.ui-next)/, "every new colour lives under the .ui-next scope");
  for (const f of ["src/ui/shell.tsx", "src/ui/frame.tsx"]) assert.match(src(f), /useDocumentTheme\(/, `${f} uses the one theme hook`);
  assert.match(src("src/ui/theme.ts"), /classList\.add\("dark"\)/, "the original dark class is put back when a new-look screen goes away");
});

test("display preferences are validated and default safely", () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs("not json"), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs(JSON.stringify({ theme: "dark", details: true })), { theme: "dark", details: true });
  assert.deepEqual(parsePrefs(JSON.stringify({ theme: "<script>", details: "yes" })), DEFAULT_PREFS, "unknown values are ignored");
  assert.deepEqual(prefsFromCookie(encodeURIComponent(JSON.stringify({ theme: "light", details: true }))), { theme: "light", details: true });
  for (const bad of ["%E0%A4%A", "%7B", undefined, ""]) assert.deepEqual(prefsFromCookie(bad), DEFAULT_PREFS, `a bad cookie (${bad}) falls back to the defaults`);
});

test("light is the default look, and an unknown cookie falls back to it", () => {
  assert.equal(DEFAULT_PREFS.theme, "light");
  assert.equal(parsePrefs(undefined).theme, "light");
});

test("the Assistants pages change how things look, not what can be done: no approvals, no new write paths", () => {
  const list = src("src/app/(next)/agents/view.tsx"), detail = src("src/app/(next)/agents/[id]/view.tsx");
  for (const file of [list, detail]) {
    assert.equal(/\bdecide\b/.test(file), false, "assistants pages never answer a request");
    assert.equal(/fetch\(|setPolicy|saveTools|savePolicy|runVerification/.test(file), false, "they reach the server only through the existing components and store actions");
  }
  assert.match(detail, /<ToolPermissions key=\{agent\.id\} agentId=\{agent\.id\} \/>/, "what an assistant may do is edited by the existing, tested component");
  assert.match(detail, /<ProtectionChecks key=\{agent\.id\} agentId=\{agent\.id\} configVersion=\{agent\.configVersion\} \/>/, "protection checks come from the existing component, not a restyled copy");
  assert.equal((detail.match(/setPaused\(/g) ?? []).length, 1, "pausing goes through the one store action");
});

test("security-relevant parts of an assistant's page are never inside a collapsed Details", () => {
  const detail = src("src/app/(next)/agents/[id]/view.tsx");
  const inside = [...detail.matchAll(/<Disclosure[\s\S]*?<\/Disclosure>/g)].map((m) => m[0]).join("\n");
  for (const part of ["ToolPermissions", "ProtectionChecks", "<Feed", "setPaused", "toggle", "permissions"])
    assert.equal(inside.includes(part), false, `${part} stays visible, whatever the display preference`);
});

test("Connect keeps the gateway and approval logic as it was: one single-request answer, the existing permissions editor, security facts always visible", () => {
  const view = src("src/app/(next)/connect/view.tsx");
  assert.equal((view.match(/\bdecide\(/g) ?? []).length, 1, "exactly one place answers, and only the one test request");
  assert.match(view, /decideTest\(state\.auth\.id, "approved"\)/);
  assert.match(view, /decideTest\(state\.auth\.id, "rejected"\)/);
  assert.equal(/approve ?all|allow ?all|bulk/i.test(view), false, "no all-at-once answer");
  assert.match(view, /<ToolPermissions agentId=\{agentId\} suggest=\{SUGGEST\} onView=\{onView\} \/>/, "what it may do is chosen in the existing, tested component");
  assert.equal(/fetch\(/.test(view), false, "it reaches the server only through store actions");
  assert.ok(view.indexOf("c.know.items") > 0, "the security facts are on the first step");
  const inside = [...view.matchAll(/<Disclosure[\s\S]*?<\/Disclosure>/g)].map((m) => m[0]).join("\n");
  for (const part of ["c.know", "ToolPermissions", "decideTest", "c.s3.keyNote"]) assert.equal(inside.includes(part), false, `${part} is never inside a collapsed Details`);
  assert.equal(/localStorage|sessionStorage|searchParams\.set|router\.(push|replace)\([^)]*key/i.test(view), false, "the key is never put in storage or the address");
});

test("the front page shows a visitor nothing about any assistant, and sends a signed-in operator straight to Home", () => {
  const page = src("src/app/page.tsx");
  // The one database read it may make is the session check that decides whether to send an operator on to Home.
  assert.equal(/useStore|getDb|snapshot|projection|agents/.test(page.replace(/\/\/.*$/gm, "").replace(/w\.points|assistants/g, "").replace("isOperator(await getDb(),", "isOperator(").replace('import { getDb } from "@/server/db";', "")), false, "no assistant data is read on the public front page");
  assert.match(page, /redirect\("\/home"\)/);
  assert.match(page, /isOperator\(await getDb\(\),/);
});

test("the whole application is one product: every screen sits in the one shell, with one set of destinations", () => {
  const walk = (dir: string): string[] => readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const pages = walk("src/app").filter((f) => f.endsWith("page.tsx") && !f.startsWith("src/app/api"));
  // The account pages (sign-in, sign-up and the pages opened from mails) come before there is anything to navigate: one card, no shell.
  // So does the first-run setup guide (/welcome): a focused sequence of steps with its own frame and a way out to Home.
  const outside = pages.filter((f) => !f.startsWith("src/app/(next)/") && !f.startsWith("src/app/account/") && !["src/app/page.tsx", "src/app/prototype/page.tsx", "src/app/welcome/page.tsx"].includes(f));
  assert.deepEqual(outside, [], "every screen is in the redesigned group (the front page, the account pages, the setup guide and the kept research prototype are the only others)");
  assert.match(src("src/app/welcome/view.tsx"), /useDocumentTheme\(/, "the setup guide follows the one theme hook");
  assert.match(src("src/app/account/layout.tsx"), /<AccountFrame>/, "the account pages share one frame");
  assert.equal(existsSync(path.join(root, "src/components/app-shell.tsx")), false, "the old navigation shell is gone");
  const shell = src("src/ui/shell.tsx");
  for (const href of ["/home", "/agents", "/oversight", "/timeline", "/policies", "/verification", "/connect", "/settings"]) assert.ok(shell.includes(`"${href}"`), `the navigation reaches ${href}`);
  assert.match(src("src/app/(next)/connect/view.tsx"), /href="\/integrations"/, "the full list of integrations stays one click from Connect");
  assert.match(src("src/app/(next)/integrations/view.tsx"), /href=\{`\/connect\?provider=/, "connecting an agent stays one click from Integrations");
  const settings = src("src/app/(next)/settings/view.tsx");
  for (const href of ["/developers", "/labs"]) assert.ok(settings.includes(`"${href}"`), `${href} stays reachable, from Settings`);
  assert.match(shell, /key: "daily"[\s\S]*?item\("home"[\s\S]*?item\("assistants"[\s\S]*?item\("approvals"[\s\S]*?item\("activity"[\s\S]*?item\("policies"[\s\S]*?key: "setup"[\s\S]*?item\("integrations"[\s\S]*?item\("verification"/, "two groups: the daily screens first, then setup (connecting an agent and the checks)");
});

test("Activity and Approvals only ever show real assistants unless the person asks for the samples", () => {
  for (const f of ["src/app/(next)/timeline/view.tsx", "src/app/(next)/oversight/view.tsx"]) {
    const text = src(f);
    assert.match(text, /useState\(false\)/, `${f} starts without samples`);
    assert.ok(/visibleAgent\(|realAssistants\(/.test(text), `${f} filters to real assistants`);
  }
});

test("the sidebar's gateway module only reports what the connection shows, and never claims protection", () => {
  const shell = src("src/ui/shell.tsx");
  assert.match(shell, /gatewayState\(status, syncedAt, now\)/, "its state comes from the live connection");
  for (const lang of ["en", "de"] as const) {
    const g = JSON.stringify(src(`src/i18n/${lang}.ts`).match(/gateway: \{[^\n]*\},\n/)?.[0] ?? "");
    assert.equal(/secure|protected|sicher|geschützt/i.test(g), false, `${lang}: the gateway wording makes no safety claim`);
  }
});

test("every destination in the sidebar has a screen, and each private screen handles signed-out and loading itself", () => {
  const nav = src("src/ui/shell.tsx");
  for (const href of ["/home", "/agents", "/timeline", "/oversight", "/policies", "/verification", "/connect", "/settings"]) {
    assert.ok(nav.includes(`"${href}"`), `${href} is in the sidebar`);
    assert.ok(existsSync(path.join(root, "src/app/(next)", href, "view.tsx")), `${href} has a screen`);
  }
  for (const page of ["home", "agents", "policies", "verification", "settings", "integrations"])
    assert.match(src(`src/app/(next)/${page}/view.tsx`), /status === "signin"/, `${page} shows sign-in instead of an empty page`);
});

test("Policies, Verification and Settings only use the real, tested actions: no invented endpoints, no 'protected' claim", () => {
  const policies = src("src/app/(next)/policies/view.tsx"), verification = src("src/app/(next)/verification/view.tsx"), settings = src("src/app/(next)/settings/view.tsx");
  assert.match(policies, /ToolPermissions/, "rules are edited with the existing, tested permissions editor");
  assert.match(settings, /rotateKey/, "keys are changed through the existing rotation, which kills the old key at once");
  assert.equal(/fetch\(/.test(policies + verification + settings), false, "no screen talks to the server except through the store");
  for (const file of [policies, verification, settings]) assert.equal(/\bprotected\b|\bsecure\b/i.test(file), false, "no claim of protection in the screen's own code");
  assert.match(settings, /shown once|once/i, "a new key is shown once");
});

test("the settings screen stays within what exists: no organization or team controls, and notification controls only with their backend", () => {
  const settings = src("src/app/(next)/settings/view.tsx");
  assert.equal(/team member|invite|organi[sz]ation/i.test(settings), false);
  // Notification settings exist because the server stores preferences and browser subscriptions (src/server/notifications.ts).
  assert.match(settings, /<NotificationSettings \/>/);
  for (const r of ["notifications/preferences", "notifications/subscriptions", "notifications/test"]) assert.ok(existsSync(path.join(root, `src/app/api/v1/${r}/route.ts`)), `${r} is served`);
});
