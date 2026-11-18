// Security-focused static analysis (CI step "Static security analysis"): eslint-plugin-security's recommended rules, as errors, on the server code.
//   npx eslint -c eslint.security.config.mjs src/server src/app/api src/lib src/proxy.ts
// Triaged off (Phase 3, SECURITY-VERIFICATION.md): each of these fires on code that was read and found safe, so leaving them on would bury real findings.
//   detect-object-injection        43 hits: lookups on fixed tables/records keyed by validated identifiers (generic pattern, no sink)
//   detect-non-literal-fs-filename 19 hits: the gateway notes tools (names matched by ^[a-z0-9-]{1,32}$, lstat, O_EXCL), e-mail outbox, verification sandbox
//   detect-non-literal-regexp / detect-unsafe-regex: policy.ts and clean.ts build regexes from constant tables; the three flagged patterns were
//     timed against 4 KB hostile inputs (< 1 ms), no catastrophic backtracking
//   detect-possible-timing-attacks 1 hit: session.ts compares the server's own cached admin token with itself, not caller input
// Everything else in the plugin stays on and fails the build.
import security from "eslint-plugin-security";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mjs"],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { security },
    rules: {
      ...Object.fromEntries(Object.keys(security.configs.recommended.rules).map((r) => [r, "error"])),
      "security/detect-object-injection": "off",
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-non-literal-regexp": "off",
      "security/detect-unsafe-regex": "off",
      "security/detect-possible-timing-attacks": "off",
    },
  },
  { ignores: ["**/*.test.ts", "**/*.test.mjs"] },
];
