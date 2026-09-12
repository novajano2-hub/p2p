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

/** The key committed in .env.example for development. Worthless by design, and
    refused in production because anyone can read it on GitHub. */
const EXAMPLE_FIELD_KEY = "5f2b0c9a41d8e37f6a1b8c2d9e0f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5";

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

/** An EVM address, shape only, lower-cased. Checksum validation arrives with the real adapter (Phase 6). */
const evmAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, { error: "must be a 0x-prefixed 40-hex-digit address" })
  .transform((value) => value.toLowerCase());

/** An amount in millionths of a USDT, as an integer string, parsed to bigint. */
const micro = (fallback: string) =>
  z
    .string()
    .regex(/^\d+$/, { error: "must be an integer number of millionths of a USDT" })
    .default(fallback)
    .transform((value) => BigInt(value));

/** Signs the mock provider's webhooks in development. Refused in production. */
const DEV_WEBHOOK_SECRET = "dev-custody-webhook-secret-not-for-production";

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

    /* Rate limiting, on by default and refused off in production (see below).
       The only reason to turn it off is the API test suite, where every request
       comes from 127.0.0.1 and a suite that registers forty accounts would
       otherwise spend the day's per-IP allowance on itself. The limiter's own
       behaviour is tested with it on, in test/api/security.spec.ts. */
    RATE_LIMIT_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),

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

    /* Encrypts single database fields the server must read back - an admin's
       TOTP secret today, payment instructions later. 32 bytes of hex; generate
       with `openssl rand -hex 32`. Required everywhere, because MFA enrollment
       happens in development too; production additionally refuses the sample
       value from .env.example (see below). */
    FIELD_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, {
      error: "must be 64 hex characters (32 bytes), e.g. from `openssl rand -hex 32`",
    }),

    /* Sessions. Two independent limits: an absolute lifetime, and an idle window
       after which an abandoned session is dead regardless of the absolute one. */
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(8_760).default(720),
    SESSION_IDLE_TTL_HOURS: z.coerce.number().int().min(1).max(8_760).default(168),

    /* An administrator's session, which is a different thing (threat model
       B7.3): hours rather than weeks, and idle-out in minutes. Somebody at a
       desk doing a task, not a phone carried around for a month. */
    ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(8),
    ADMIN_SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(480).default(30),
    /* Defaults closed: a session cookie must not travel over plain HTTP. Local
       development over http://localhost is the only reason to turn it off. */
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    COOKIE_DOMAIN: z.string().min(1).optional(),

    /* ------------------------------------------------------------ chain */

    /* The one network at launch - BNB Smart Chain, decided 2026-09-12 (ADR-0006)
       - and everything about it that is a fact of the network rather than a
       choice of ours. All of it is configuration so that a change of network
       is a change of values, and so that no domain code ever names a chain. */
    CHAIN_NETWORK: z.enum(["BSC"]).default("BSC"),
    CHAIN_ID: z.coerce.number().int().positive().default(56),
    USDT_CONTRACT: evmAddress.default("0x55d398326f99059ff775485246999027b3197955"),
    /** BEP-20 USDT carries 18 decimals; the ledger carries 6. Converted once, at the edge. */
    USDT_DECIMALS: z.coerce.number().int().min(6).max(30).default(18),

    /* Finality (open-questions Q5). Deliberately conservative: a deposit is
       credited at DEPOSIT_CONFIRMATIONS, and a transfer missing from the
       canonical chain for REORG_DEPTH blocks is treated as gone. UNVALIDATED
       against the live network until Phase 6 runs the suite against it. */
    DEPOSIT_CONFIRMATIONS: z.coerce.number().int().min(1).max(1_000).default(15),
    REORG_DEPTH: z.coerce.number().int().min(1).max(10_000).default(30),

    /* Policy amounts, in millionths of a USDT. The review and approval
       thresholds are set high on purpose: an ordinary deposit or withdrawal
       never meets a human (see state-machines.md). */
    DEPOSIT_DUST_MICRO: micro("1000000"),
    DEPOSIT_REVIEW_THRESHOLD_MICRO: micro("10000000000"),
    WITHDRAWAL_MIN_MICRO: micro("1000000"),
    WITHDRAWAL_MAX_MICRO: micro("50000000000"),
    WITHDRAWAL_DAILY_MAX_MICRO: micro("100000000000"),
    /* Both are read against the customer's KYC daily ceiling, which is lower
       (KYC_TIERS: 2,000 USDT verified, 100 unverified). Thresholds above that
       ceiling would be unreachable - nobody could ever request enough to trip
       them - so these sit below it: under 500 USDT goes straight through,
       500 and over wants one administrator, 1,500 and over wants two. Figures
       to confirm with the owner before real funds. */
    WITHDRAWAL_AUTO_APPROVE_MICRO: micro("500000000"),
    WITHDRAWAL_DUAL_APPROVAL_MICRO: micro("1500000000"),
    WITHDRAWAL_NEW_ADDRESS_COOLDOWN_HOURS: z.coerce.number().int().min(0).max(720).default(24),

    /* Sweeping. Below this it costs more gas to move the coins than they are
       worth moving, so they wait for the next deposit to join them. */
    SWEEP_MIN_MICRO: micro("5000000"),

    /* A reconciliation difference smaller than this is noise rather than a
       break - rounding at the edge of a token's decimals, mostly. Zero would
       be the strictest setting and is the right one while BSC is the only
       network; it is configurable because a network that rounds would need it. */
    RECONCILIATION_TOLERANCE_MICRO: micro("0"),

    /* The adapters at the edge (ADR-0006). Only the deterministic mocks exist
       until Phase 6; a real one is a new value here and a new file there. */
    BLOCKCHAIN_GATEWAY: z.enum(["mock"]).default("mock"),
    CUSTODY_PROVIDER: z.enum(["mock"]).default("mock"),
    RISK_ENGINE: z.enum(["mock"]).default("mock"),
    /** Verifies the provider's webhooks over the raw body. The sample value is refused in production. */
    CUSTODY_WEBHOOK_SECRET: z.string().min(16).default(DEV_WEBHOOK_SECRET),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.FIELD_ENCRYPTION_KEY === EXAMPLE_FIELD_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["FIELD_ENCRYPTION_KEY"],
        message:
          "is the sample value from .env.example, which is public. Generate a real one: openssl rand -hex 32",
      });
    }
    if (env.NODE_ENV === "production" && env.CUSTODY_WEBHOOK_SECRET === DEV_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["CUSTODY_WEBHOOK_SECRET"],
        message:
          "is the development sample, which is public. Set the secret the custody provider signs with",
      });
    }
    if (env.WITHDRAWAL_MIN_MICRO > env.WITHDRAWAL_MAX_MICRO) {
      ctx.addIssue({
        code: "custom",
        path: ["WITHDRAWAL_MAX_MICRO"],
        message: "must be at least WITHDRAWAL_MIN_MICRO",
      });
    }
    if (env.NODE_ENV === "production" && !env.RATE_LIMIT_ENABLED) {
      ctx.addIssue({
        code: "custom",
        path: ["RATE_LIMIT_ENABLED"],
        message:
          "cannot be false in production: it is the only thing between the log-in endpoints and unlimited attempts",
      });
    }
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
