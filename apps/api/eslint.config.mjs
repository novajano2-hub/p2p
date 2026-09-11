import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/*
  Type-aware linting for the API. The rules below are the ones that catch the
  bugs that matter in a service that moves money: a forgotten `await` on a
  database call, a promise handed to something that expected a value, a
  `switch` over a state enum that silently ignores a new state.
*/
export default tseslint.config(
  // global-teardown.js is a plain CommonJS script Jest loads outside the
  // test environment, so it is deliberately not in the TypeScript project
  // that the type-aware rules below need.
  { ignores: ["dist/**", "coverage/**", "*.config.mjs", "test/global-teardown.js"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Nest wires classes by constructor injection; "empty" classes are modules.
      "@typescript-eslint/no-extraneous-class": "off",
      // Prisma and Fastify types use `null` deliberately; unions are the honest shape.
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    files: ["test/**/*.ts", "src/**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  prettier,
);
