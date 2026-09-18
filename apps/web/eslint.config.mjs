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
  // Every toast goes through lib/toast.ts, so they all share one set of timings
  // and one shape; only that module and the toaster itself touch sonner.
  {
    ignores: ["lib/toast.ts", "lib/toast.spec.ts", "components/app/toaster.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "sonner", message: "Import toast from @/lib/toast instead." }] },
      ],
    },
  },
]);

export default eslintConfig;
