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
    // What a Playwright run leaves behind. The report is a bundled React
    // app, so linting it reports three thousand problems in somebody
    // else's minified code - which is what `npm run lint` did after every
    // local e2e run.
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
