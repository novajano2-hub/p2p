/*
  Two Jest projects with one transform:

    unit  fast, no infrastructure. State machines, ledger rules, money, config.
    api   Supertest against a booted app with a real PostgreSQL and Redis.
          Run in band: the tests share one database and use transactions
          and truncation to isolate, and parallel workers would race.

  SWC compiles TypeScript with decorator metadata so Nest's dependency
  injection resolves in tests exactly as it does in the build.
*/

/** @type {import('@swc/core').Options} */
const swcOptions = {
  jsc: {
    parser: { syntax: "typescript", decorators: true },
    transform: { legacyDecorator: true, decoratorMetadata: true },
    target: "es2022",
    keepClassNames: true,
  },
  module: { type: "commonjs" },
  sourceMaps: "inline",
};

const shared = {
  testEnvironment: "node",
  transform: { "^.+\\.ts$": ["@swc/jest", swcOptions] },
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  clearMocks: true,
};

/** @type {import('jest').Config} */
export default {
  projects: [
    {
      ...shared,
      displayName: "unit",
      testMatch: ["<rootDir>/src/**/*.spec.ts", "<rootDir>/test/unit/**/*.spec.ts"],
    },
    {
      ...shared,
      displayName: "api",
      testMatch: ["<rootDir>/test/api/**/*.spec.ts"],
      setupFiles: ["<rootDir>/test/setup-env.ts"],
      testTimeout: 30_000,
    },
  ],
};
