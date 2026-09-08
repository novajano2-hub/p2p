import { apiError, healthResponse, readinessResponse } from "@abay/contracts";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";

import { createApp } from "@/app";
import { loadEnv } from "@/config/env";

/*
  Boots the real application (the same createApp the entrypoint uses) and
  talks to it over HTTP. With PostgreSQL and Redis reachable, /ready is 200;
  without them it must be an honest 503, never a crash and never a leak.
*/

let app: NestFastifyApplication;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

beforeAll(async () => {
  app = await createApp(loadEnv());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("is liveness only: ok, a request id, and nothing cacheable", async () => {
    const res = await request(server()).get("/health").expect(200);
    expect(healthResponse.parse(res.body)).toEqual({ status: "ok" });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("GET /ready", () => {
  it("reports each dependency and fails closed without leaking internals", async () => {
    const res = await request(server()).get("/ready");
    const body = readinessResponse.parse(res.body);
    const allOk = body.checks.database === "ok" && body.checks.redis === "ok";
    expect(body.status).toBe(allOk ? "ready" : "degraded");
    expect(res.status).toBe(allOk ? 200 : 503);
    expect(JSON.stringify(res.body)).not.toMatch(
      /localhost|5432|6379|ECONNREFUSED|password|timed out/i,
    );
  });
});

describe("request ids", () => {
  it("honours a safe client-supplied id and replaces an unsafe one", async () => {
    const honoured = await request(server())
      .get("/health")
      .set("x-request-id", "trace-abc.123_456");
    expect(honoured.headers["x-request-id"]).toBe("trace-abc.123_456");

    const replaced = await request(server())
      .get("/health")
      .set("x-request-id", "bad id with spaces\tand tabs");
    expect(replaced.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("errors", () => {
  it("returns the error envelope for unknown routes, tagged with the request id", async () => {
    const res = await request(server()).get("/v1/definitely-not-a-route").expect(404);
    const body = apiError.parse(res.body);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.correlationId).toBe(res.headers["x-request-id"]);
  });
});

describe("browser security", () => {
  it("allows only configured origins", async () => {
    const allowed = await request(server())
      .options("/health")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const denied = await request(server())
      .options("/health")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "GET");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sends hardening headers on every response", async () => {
    const res = await request(server()).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toBeDefined();
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
