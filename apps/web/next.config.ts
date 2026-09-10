import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { NextConfig } from "next";

/*
  One env file for the whole repository, at the root, read here because Next
  only looks inside its own app directory. Kept to a dozen lines rather than a
  dependency: this reads KEY=value and nothing else - no expansion, no
  multi-line values, no quoting beyond stripping a surrounding pair.

  The values reach the bundle through `env` below rather than by assignment
  onto process.env: a build spawns worker processes, and they do not inherit a
  mutation made while this file was evaluated. `env` is the documented way to
  inline a value, and it reaches every worker.
*/
function readRootEnv(): Record<string, string> {
  const values: Record<string, string> = {};
  try {
    const file = readFileSync(resolve(process.cwd(), "../../.env"), "utf8");
    // Split on a regex, so a file written with Windows line endings does not
    // leave a stray carriage return on the end of every value.
    for (const line of file.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (key === undefined || rawValue === undefined) continue;
      values[key] = rawValue.trim().replace(/^["'](.*)["']$/, "$1");
    }
  } catch {
    // No file: the environment is expected to be set some other way, and
    // lib/auth/client.ts fails loudly if the one value it needs is missing.
  }
  return values;
}

const rootEnv = readRootEnv();

/** The real environment wins, so CI and a deployment override the file. */
const fromEnv = (key: string): string => process.env[key] ?? rootEnv[key] ?? "";

/*
  Baseline browser security headers. A Content-Security-Policy with nonces is
  added in Phase 1 alongside the authenticated app, where inline-script policy
  actually matters. Tracked in docs/open-questions.md, not as a code TODO.
*/
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // Inlined into the browser bundle at build time. Nothing secret belongs here.
  env: { NEXT_PUBLIC_API_URL: fromEnv("NEXT_PUBLIC_API_URL") },
  reactStrictMode: true,
  poweredByHeader: false,
  // three.js ships ESM; transpiling keeps tree-shaking effective through drei.
  transpilePackages: ["three"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
