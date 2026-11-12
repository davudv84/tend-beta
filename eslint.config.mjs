import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Integration verification: installed framework packages and Python environments (npm run verify:setup).
    ".verify/**",
    "scripts/verify/frameworks/node_modules/**",
    // Red-team harness: an adversarial repro script (redteam/attacks.ts) and its report, not part of the app.
    "redteam/**",
    // Local data and tool state, never part of the app.
    ".data/**",
    "**/.claude-flow/**",
  ]),
]);

export default eslintConfig;
