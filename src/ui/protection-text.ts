// A protection check's title and sentence in the reader's language, from the same dictionary the Protection checks panel uses.
// Tool ids become the names a person knows; lists become plain text.
import type { Dict } from "@/i18n";
import type { CheckResult } from "@/lib/verification";

export const checkTitle = (t: Dict, c: Pick<CheckResult, "id">) => t.protection.checks[c.id].title;

export function checkSentence(t: Dict, c: CheckResult) {
  const facts = Object.fromEntries(
    Object.entries(c.facts).map(([k, v]) => [k, !Array.isArray(v) ? v : k === "failed" ? v.map((x) => t.protection.failed[x] ?? x).join("; ") : v.map((x) => t.tools.names[x] ?? x).join(", ")]),
  );
  return c.status === "verified" ? t.protection.checks[c.id].verified(facts) : (t.protection.reasons[c.why ?? ""] ?? (() => ""))(facts);
}
