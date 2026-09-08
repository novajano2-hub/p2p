import { z } from "zod";

/*
  The environment, validated once at boot. The process refuses to start on a
  missing or malformed value rather than discovering it on the first request.

  The error lists variable names and the rule each broke. It never includes a
  value: a mistyped DATABASE_URL still contains a password.
*/

const flag = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

/** An exact origin: scheme and host, no path, no trailing slash, no wildcard. */
const origin = z.string().refine(
  (value) => {
    try {
      return new URL(value).origin === value;
    } catch {
      return false;
    }
  },
  { error: "must be an exact origin such as https://app.example.com (no path, no wildcard)" },
);

const originList = z
  .string()
  .transform((raw) =>
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .pipe(z.array(origin).min(1, { error: "at least one origin is required" }));

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  HOST: z.string().min(1).default("127.0.0.1"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Only true behind a proxy that sets X-Forwarded-*; otherwise clients spoof their IP. */
  TRUST_PROXY: flag,
  CORS_ORIGINS: originList,
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: "must be a postgresql:// URL",
  }),
  REDIS_URL: z.url({ protocol: /^rediss?$/, error: "must be a redis:// or rediss:// URL" }),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).max(120_000).default(10_000),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid environment:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    this.name = "EnvError";
  }
}

/** Parse and validate the environment. Throws EnvError with names and rules, never values. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const name = issue.path.length > 0 ? issue.path.map(String).join(".") : "(environment)";
      return `${name}: ${issue.message}`;
    });
    throw new EnvError(problems);
  }
  return result.data;
}
