import assert from "node:assert/strict";
import test from "node:test";
import { pickLocale } from "./config.ts";
import { DICTS, errorText } from "./index.ts";

test("the browser language picks the interface language, honouring q-values", () => {
  assert.equal(pickLocale(null), "en");
  assert.equal(pickLocale(""), "en");
  assert.equal(pickLocale("de-DE,de;q=0.9,en;q=0.8"), "de");
  assert.equal(pickLocale("de-CH"), "de");
  assert.equal(pickLocale("en-US,en;q=0.9,de;q=0.8"), "en");
  assert.equal(pickLocale("fr-FR,fr;q=0.9,de;q=0.5"), "de");
  assert.equal(pickLocale("en;q=0.2,de;q=0.7"), "de");
  assert.equal(pickLocale("fr,it"), "en");
  assert.equal(pickLocale("de;q=0"), "en");
});

/** Every leaf: its path, what it is, and its value. Arrays are compared by length and element shape. */
function leaves(v: unknown, path = ""): [string, string, unknown][] {
  if (typeof v === "function") return [[path, "function", v]];
  if (typeof v === "string") return [[path, "string", v]];
  if (Array.isArray(v)) return [[path, `array(${v.length})`, v], ...v.flatMap((x, i) => leaves(x, `${path}[${i}]`))];
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k));
  return [[path, typeof v, v]];
}
const shape = (v: unknown) => leaves(v).map(([path, kind]) => [path, kind]);

test("German covers exactly the English keys, with the same shapes", () => {
  assert.deepEqual(shape(DICTS.de), shape(DICTS.en));
});

test("no interface text is empty, and every text function returns text", () => {
  for (const [locale, dict] of Object.entries(DICTS))
    for (const [path, kind, v] of leaves(dict)) {
      if (kind === "string" && path !== "common.originalLanguage") assert.ok((v as string).trim(), `${locale}: ${path} is empty`);
      if (kind === "function") {
        const out = (v as (...a: unknown[]) => unknown)(2, 3, true);
        assert.ok(typeof out === "string" || Array.isArray(out), `${locale}: ${path} returned ${typeof out}`);
      }
    }
});

test("German text is actually translated", () => {
  // Words that are the same in both languages, and technical terms that stay as they are.
  const same = new Set(["Gateway", "Operator", "Filter", "Status", "Details", "Agent", "Name", "Offline", "Banner", "System", "Navigation", "optional", "Sanctuary", "Agents", "Reflections", "Check-ins", "Timeline", "Research Lab", "Oversight", "API contract", "English", "Deutsch", "Switch to English", "Auf Deutsch umstellen", "DEMO", "auto", "Labs", "Frameworks"]);
  const de = new Map(leaves(DICTS.de).map(([path, , v]) => [path, v]));
  const identical = leaves(DICTS.en)
    .filter(([path, kind, v]) => kind === "string" && /[a-z]/i.test(v as string) && !path.startsWith("intl") && !path.endsWith(".code"))
    .filter(([path, , v]) => de.get(path) === v && !same.has(v as string))
    .map(([path]) => path);
  assert.deepEqual(identical, []);
});

test("server errors are shown in the reader's language when known, and as sent otherwise", () => {
  assert.equal(errorText(DICTS.de, { error: "x", code: "rate_limited" }), DICTS.de.errors.codes.rate_limited);
  assert.equal(errorText(DICTS.de, { error: "x", code: "network" }), DICTS.de.errors.network);
  assert.equal(errorText(DICTS.de, { error: "Something specific", code: "unknown_code" }), "Something specific");
});

test("German uses German quotation marks and spacing", () => {
  assert.equal(DICTS.de.quote("hallo"), "„hallo“");
  assert.equal(DICTS.de.pct(42), "42 %");
  assert.equal(DICTS.en.pct(42), "42%");
});

test("a recorded policy rule reads as one plain sentence in both languages", () => {
  const push = { tool: "shell", action: "*", effect: "approve" as const, when: { command: { contains: "git push" } } };
  const env = { tool: "file.write", action: "*", effect: "approve" as const, when: { path: { contains: ".env" } } };
  assert.equal(DICTS.en.timelinePage.rule(push), "Commands containing “git push” wait for a person");
  assert.equal(DICTS.en.timelinePage.rule(env), "File changes whose path contains “.env” wait for a person");
  assert.equal(DICTS.en.timelinePage.rule({ tool: "web", action: "*", effect: "deny" }), "All web requests are blocked");
  assert.equal(DICTS.de.timelinePage.rule(push), "Befehle mit „git push“ warten auf einen Menschen");
  assert.equal(DICTS.de.timelinePage.rule(env), "Dateiänderungen, deren Pfad „.env“ enthält, warten auf einen Menschen");
});
