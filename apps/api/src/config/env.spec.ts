import { EnvError, loadEnv } from "./env";

const valid = {
  NODE_ENV: "test",
  CORS_ORIGINS: "http://localhost:3000, https://app.example.com",
  WEB_URL: "http://localhost:3000",
  API_URL: "http://localhost:3001",
  EMAIL_FROM: "BIRQ <no-reply@example.com>",
  DATABASE_URL: "postgresql://abay_app:app@localhost:5432/abay?schema=public",
  REDIS_URL: "redis://localhost:6379",
};

/** A complete object store configuration, as production requires. */
const storage = {
  STORAGE_ENDPOINT: "https://abc123.r2.cloudflarestorage.com",
  STORAGE_BUCKET: "birq-kyc",
  STORAGE_ACCESS_KEY_ID: "key-id",
  STORAGE_SECRET_ACCESS_KEY: "secret",
};

describe("loadEnv", () => {
  it("parses a valid environment and applies defaults", () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3001);
    expect(env.HOST).toBe("127.0.0.1");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.TRUST_PROXY).toBe(false);
    expect(env.SHUTDOWN_TIMEOUT_MS).toBe(10_000);
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:3000", "https://app.example.com"]);
  });

  it("coerces numbers and flags from strings", () => {
    const env = loadEnv({ ...valid, PORT: "8080", TRUST_PROXY: "true" });
    expect(env.PORT).toBe(8080);
    expect(env.TRUST_PROXY).toBe(true);
  });

  it("names the variable that is wrong and never echoes its value", () => {
    const secret = "postgresql://user:hunter2@db.internal:5432/abay";
    expect(() =>
      loadEnv({ ...valid, DATABASE_URL: "hunter2-not-a-url", REDIS_URL: secret }),
    ).toThrow(EnvError);
    try {
      loadEnv({ ...valid, DATABASE_URL: "hunter2-not-a-url", REDIS_URL: secret });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("REDIS_URL");
      expect(message).not.toContain("hunter2");
      expect(message).not.toContain("db.internal");
    }
  });

  it("rejects origins with paths or wildcards", () => {
    expect(() => loadEnv({ ...valid, CORS_ORIGINS: "https://app.example.com/" })).toThrow(
      /CORS_ORIGINS/,
    );
    expect(() => loadEnv({ ...valid, CORS_ORIGINS: "*" })).toThrow(/CORS_ORIGINS/);
    expect(() => loadEnv({ ...valid, CORS_ORIGINS: "" })).toThrow(/CORS_ORIGINS/);
  });

  it("treats a blank secret as absent, so `KEY=` in a .env file is not an empty key", () => {
    const env = loadEnv({
      ...valid,
      RESEND_API_KEY: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
    });
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it("refuses to start production without a way to send email", () => {
    const production = { ...valid, ...storage, NODE_ENV: "production", COOKIE_SECURE: "true" };
    expect(() => loadEnv(production)).toThrow(/RESEND_API_KEY/);
    expect(() => loadEnv({ ...production, RESEND_API_KEY: "re_x" })).not.toThrow();
  });

  it("refuses to start production without somewhere to keep identity documents", () => {
    expect(() =>
      loadEnv({ ...valid, NODE_ENV: "production", COOKIE_SECURE: "true", RESEND_API_KEY: "re_x" }),
    ).toThrow(/STORAGE_BUCKET/);
  });

  it("requires the object store settings together, with a real URL for the endpoint", () => {
    expect(() => loadEnv({ ...valid, STORAGE_BUCKET: "birq-kyc" })).toThrow(/STORAGE_/);
    expect(() =>
      loadEnv({ ...valid, ...storage, STORAGE_ENDPOINT: "abc123.r2.cloudflarestorage.com" }),
    ).toThrow(/STORAGE_ENDPOINT/);

    const env = loadEnv({ ...valid, ...storage });
    expect(env.STORAGE_BUCKET).toBe("birq-kyc");
    expect(env.STORAGE_REGION).toBe("auto");
    expect(env.STORAGE_LOCAL_DIR).toBe(".storage");

    // Blank means absent here too, so the example file's empty lines are fine.
    const blank = loadEnv({
      ...valid,
      STORAGE_ENDPOINT: "",
      STORAGE_BUCKET: "",
      STORAGE_ACCESS_KEY_ID: "",
      STORAGE_SECRET_ACCESS_KEY: "",
    });
    expect(blank.STORAGE_BUCKET).toBeUndefined();
  });

  it("requires the Google client id and secret together", () => {
    expect(() => loadEnv({ ...valid, GOOGLE_CLIENT_ID: "id-only" })).toThrow(
      /GOOGLE_CLIENT_SECRET/,
    );
    expect(() =>
      loadEnv({ ...valid, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" }),
    ).not.toThrow();
  });

  it("requires the web and API origins to be exact origins", () => {
    expect(() => loadEnv({ ...valid, WEB_URL: "http://localhost:3000/app" })).toThrow(/WEB_URL/);
    expect(() => loadEnv({ ...valid, API_URL: "localhost:3001" })).toThrow(/API_URL/);
  });

  it("requires the database URL to be PostgreSQL and the cache URL to be Redis", () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: "mysql://x@localhost/abay" })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => loadEnv({ ...valid, REDIS_URL: "http://localhost:6379" })).toThrow(/REDIS_URL/);
  });
});
