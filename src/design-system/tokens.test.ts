import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contrast } from "./contrast.ts";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Custom properties declared in the block(s) whose selector matches. Later blocks override earlier ones. */
function vars(selectorRe: RegExp): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorRe.test(m[1].trim())) continue;
    for (const d of m[2].matchAll(/(--t-[\w-]+):\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  }
  return out;
}
const light = { ...vars(/^\.tds$/), ...vars(/^\.tds,\s*\.tds\[data-theme="light"\]$/) };
const dark = { ...light, ...vars(/^\.tds\[data-theme="dark"\]$/) };

// [foreground, background, minimum ratio]
const PAIRS: [string, string, number][] = [
  ["ink", "canvas", 7], ["text", "canvas", 7], ["muted", "canvas", 4.5], ["muted", "sunken", 4.5], ["muted", "surface", 4.5],
  ["accent-text", "canvas", 4.5], ["accent-fg", "accent", 4.5], ["accent-fg", "accent-hover", 4.5],
  ["ok-ink", "ok-soft", 4.5], ["warn-ink", "warn-soft", 4.5], ["danger-ink", "danger-soft", 4.5], ["info-ink", "info-soft", 4.5],
  ["ok-ink", "canvas", 4.5], ["warn-ink", "canvas", 4.5], ["danger-ink", "canvas", 4.5],
  ["danger-fg", "danger", 4.5], ["danger-fg", "danger-hover", 4.5], ["inverse-text", "inverse", 4.5], ["code-key", "code-bg", 4.5], ["code-string", "code-bg", 4.5], ["code-number", "code-bg", 4.5], ["code-comment", "code-bg", 4.5],
  ["focus", "canvas", 3], ["line-strong", "canvas", 1.4],
];

for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
  test(`contrast, ${name} theme`, () => {
    for (const [fg, bg, min] of PAIRS) {
      const a = theme[`--t-${fg}`], b = theme[`--t-${bg}`];
      assert.ok(a?.startsWith("#") && b?.startsWith("#"), `${fg}/${bg} must be hex (${a}, ${b})`);
      const r = contrast(a, b);
      assert.ok(r >= min, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min}:1`);
    }
  });
}
test("dark theme defines every semantic token the light theme does", () => {
  const semantic = (o: Record<string, string>) => Object.keys(o).filter((k) => !/-(\d+)$|space|radius|dur|ease|move|font|w-|control|row|pad|gap|section|drawer/.test(k)).sort();
  const d = vars(/^\.tds\[data-theme="dark"\]$/);
  for (const k of semantic(vars(/^\.tds,\s*\.tds\[data-theme="light"\]$/))) assert.ok(k in d, `dark is missing ${k}`);
});

test('the "system" theme (a media query) carries exactly the dark theme\'s tokens', () => {
  const media = css.match(/@media \(prefers-color-scheme: dark\) \{\s*\.tds\[data-theme="system"\] \{([^}]*)\}/);
  assert.ok(media, "the system block exists");
  const sys: Record<string, string> = {};
  for (const d of media[1].matchAll(/(--t-[\w-]+):\s*([^;]+);/g)) sys[d[1]] = d[2].trim();
  assert.deepEqual(sys, vars(/^\.tds\[data-theme="dark"\]$/));
});
