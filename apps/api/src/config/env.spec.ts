import { EnvError, loadEnv } from "./env";

const valid = {
  NODE_ENV: "test",
  CORS_ORIGINS: "http://localhost:3000, https://app.example.com",
  DATABASE_URL: "postgresql://abay_app:app@localhost:5432/abay?schema=public",
  REDIS_URL: "redis://localhost:6379",
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

  it("requires the database URL to be PostgreSQL and the cache URL to be Redis", () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: "mysql://x@localhost/abay" })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => loadEnv({ ...valid, REDIS_URL: "http://localhost:6379" })).toThrow(/REDIS_URL/);
  });
});
