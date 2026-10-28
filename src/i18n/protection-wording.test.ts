// Verified Protection must never overclaim. The words people might read as "this agent is safe" are not allowed anywhere in
// the protection texts, in either language, and the only status labels are the three defined ones.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { DICTS } from "./index.ts";

/** Every string in the protection texts, calling text functions with sample facts. */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (typeof v === "function") {
    const facts = { mode: "0700", checked: 3, missing: 1, usedTwice: 1, reports: 2, tested: "a, b", notTested: "c", failed: "x; y", ranWithoutAsking: 0 };
    const out = (v as (...a: unknown[]) => unknown)(facts, facts);
    return typeof out === "string" ? [out] : [];
  }
  return v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];
}

const OVERCLAIM = /fully protected|fully secure|\bsecure[sd]?\b|\bsafe(ly)?\b|guarantee|bulletproof|unhackable|vollständig geschützt|\bgeschützt\b|\bsicher(e[nrms]?)?\b|garantiert|lückenlos|\bschutzgarantie/i;
// "safe or unsafe" appears once in the Not Verified note, to say that Not Verified is neither; it is the only allowed use.
const ALLOWED = [/weder sicher noch unsicher/i, /not the same as safe or unsafe/i];

test("no protection, Home or Connect text claims safety, security or a guarantee, in English or German", () => {
  for (const locale of ["en", "de"] as const) {
    const bad = [...strings(DICTS[locale].protection), ...strings(DICTS[locale].home), ...strings(DICTS[locale].ui), ...strings(DICTS[locale].connect)].filter((s) => OVERCLAIM.test(s) && !ALLOWED.some((a) => a.test(s)));
    assert.deepEqual(bad, [], `${locale}: overclaiming text`);
  }
});

test("there are exactly three statuses, with the agreed English labels, and no overall verdict text", () => {
  assert.deepEqual(DICTS.en.protection.status, { verified: "Verified", at_risk: "At Risk", not_verified: "Not Verified" });
  assert.deepEqual(Object.keys(DICTS.de.protection.status).sort(), ["at_risk", "not_verified", "verified"]);
  for (const locale of ["en", "de"] as const)
    assert.equal(Object.keys(DICTS[locale].protection).some((k) => /score|grade|rating|overall|total|summary/i.test(k)), false, `${locale}: a key suggests an overall result`);
});

test("the panel and the docs don't introduce an overall label either", () => {
  const root = path.join(import.meta.dirname, "..", "..");
  for (const file of ["src/components/protection-checks.tsx", "docs/verification.md"]) {
    let text: string;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue; // the doc is written after the code
    }
    // Docs may quote the forbidden phrases to forbid them, so only look for them used as a label or result.
    assert.equal(/(label|title|status)\s*[:=]\s*["'`][^"'`]*(fully protected|protected|secure)\b/i.test(text), false, `${file}: an overall label`);
    assert.equal(/\b\d+\s*\/\s*\d+\b|\bscore\b/i.test(file.endsWith(".tsx") ? text : ""), false, `${file}: a score`);
  }
});
