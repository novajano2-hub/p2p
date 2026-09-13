/*
  Unit tests for the browser's pure modules, and only those.

  There is one thing in this app that has to be tested the way the API's money
  is tested: lib/money.ts, which parses what a person typed into millionths and
  formats millionths back into digits. That is arithmetic on somebody's money
  happening in a browser, so AT-21's round-trip requirement applies to it as
  much as it does to the server's copy.

  Components are not tested here. They are covered by Playwright against a real
  page (apps/web/e2e), which is where a UI assertion is worth making.
*/

/** @type {import('@swc/core').Options} */
const swcOptions = {
  jsc: { parser: { syntax: "typescript" }, target: "es2022" },
  module: { type: "commonjs" },
  sourceMaps: "inline",
};

/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  transform: { "^.+\.ts$": ["@swc/jest", swcOptions] },
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
  testMatch: ["<rootDir>/lib/**/*.spec.ts"],
  clearMocks: true,
};

export default config;
