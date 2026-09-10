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
      .map((entry) => trim(entry))
      .filter(Boolean),
  )
  .pipe(z.array(origin).min(1, { error: "at least one origin is required" }));

const trim = (value: string) => value.trim();

const isHttpUrl = (value: string): boolean => {
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
};

/** A value that may be left blank in a .env file: `KEY=` reads as absent, not as "". */
const blankAsAbsent = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(0).max(65535).default(3001),
    HOST: z.string().min(1).default("127.0.0.1"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    /** Only true behind a proxy that sets X-Forwarded-*; otherwise clients spoof their IP. */
    TRUST_PROXY: flag,
    CORS_ORIGINS: originList,

    /* Where the browser lives, and where this API is reachable from it. A
       finished Google sign-in sends the browser back to WEB_URL; API_URL is
       what Google is told to redirect to, so it must be the public origin of
       this process, not the bind address. */
    WEB_URL: origin,
    API_URL: origin,

    /** Shown in emails. A placeholder brand, mirrored from apps/web/lib/site.ts. */
    APP_NAME: z.string().min(1).default("BIRQ"),

    DATABASE_URL: z.url({
      protocol: /^postgres(ql)?$/,
      error: "must be a postgresql:// URL",
    }),
    REDIS_URL: z.url({ protocol: /^rediss?$/, error: "must be a redis:// or rediss:// URL" }),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).max(120_000).default(10_000),

    /* Email. EMAIL_FROM is the sender every verification code goes out as,
       e.g. "BIRQ <no-reply@example.com>". Outside production the API key may
       be left blank, in which case codes are written to the log instead of
       sent; production refuses to start without it (see the check below). */
    EMAIL_FROM: z
      .string()
      .min(3, { error: "the sender address, e.g. BIRQ <no-reply@example.com>" }),
    RESEND_API_KEY: blankAsAbsent,

    /* Google sign-in. Both or neither: with neither, the Google routes report
       the option as unavailable instead of half-working. */
    GOOGLE_CLIENT_ID: blankAsAbsent,
    GOOGLE_CLIENT_SECRET: blankAsAbsent,

    /* Object storage, for identity documents. Any S3-compatible store; the
       four connection values are set together or not at all. With none,
       outside production, photographs are kept under STORAGE_LOCAL_DIR on
       disk; production refuses to start without a real store (see the check
       below), because a container's disk is not storage. */
    STORAGE_ENDPOINT: blankAsAbsent,
    STORAGE_REGION: z.string().min(1).default("auto"),
    STORAGE_BUCKET: blankAsAbsent,
    STORAGE_ACCESS_KEY_ID: blankAsAbsent,
    STORAGE_SECRET_ACCESS_KEY: blankAsAbsent,
    STORAGE_LOCAL_DIR: z.string().min(1).default(".storage"),

    /* Sessions. Two independent limits: an absolute lifetime, and an idle window
       after which an abandoned session is dead regardless of the absolute one. */
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(8_760).default(720),
    SESSION_IDLE_TTL_HOURS: z.coerce.number().int().min(1).max(8_760).default(168),
    /* Defaults closed: a session cookie must not travel over plain HTTP. Local
       development over http://localhost is the only reason to turn it off. */
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    COOKIE_DOMAIN: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "required in production: verification codes cannot be logged instead of sent",
      });
    }
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_SECRET"],
        message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together",
      });
    }

    const storage = {
      STORAGE_ENDPOINT: env.STORAGE_ENDPOINT,
      STORAGE_BUCKET: env.STORAGE_BUCKET,
      STORAGE_ACCESS_KEY_ID: env.STORAGE_ACCESS_KEY_ID,
      STORAGE_SECRET_ACCESS_KEY: env.STORAGE_SECRET_ACCESS_KEY,
    };
    const unset = Object.entries(storage)
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (unset.length > 0 && unset.length < Object.keys(storage).length) {
      ctx.addIssue({
        code: "custom",
        path: [unset[0] ?? "STORAGE_ENDPOINT"],
        message:
          "STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY must be set together",
      });
    }
    if (env.NODE_ENV === "production" && unset.length === Object.keys(storage).length) {
      ctx.addIssue({
        code: "custom",
        path: ["STORAGE_BUCKET"],
        message: "required in production: identity documents cannot be kept on a container's disk",
      });
    }
    if (env.STORAGE_ENDPOINT && !isHttpUrl(env.STORAGE_ENDPOINT)) {
      ctx.addIssue({
        code: "custom",
        path: ["STORAGE_ENDPOINT"],
        message: "must be a URL such as https://<account id>.r2.cloudflarestorage.com",
      });
    }
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
