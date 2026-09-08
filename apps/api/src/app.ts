import { type IncomingMessage } from "node:http";

import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";

import { AppModule } from "@/app.module";
import { AppExceptionFilter } from "@/common/errors/app-exception.filter";
import { requestIdFrom } from "@/common/request-id";
import { type Env } from "@/config/env";

/** Hard cap on request bodies. Nothing this API accepts is anywhere near it. */
const BODY_LIMIT_BYTES = 1_048_576;

/*
  Builds the application without listening, so the entrypoint and the API
  tests boot exactly the same server. Everything that shapes a request's
  security posture is set here, in one place, in this order.
*/
export async function createApp(env: Env): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger: false,
    trustProxy: env.TRUST_PROXY,
    bodyLimit: BODY_LIMIT_BYTES,
    // Fastify would otherwise trust the header verbatim; requestIdFrom sanitises it.
    requestIdHeader: false,
    genReqId: (request: IncomingMessage) => requestIdFrom(request.headers["x-request-id"]),
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env), adapter, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix("v1", { exclude: ["health", "ready"] });
  app.useGlobalFilters(app.get(AppExceptionFilter));

  // A JSON API needs no script, style, frame or object of any kind.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
  });

  // Exact origins only, from validated config. Credentials are allowed because
  // sessions are cookies; that is precisely why the origin list is strict.
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "x-request-id", "x-csrf-token", "idempotency-key"],
    exposedHeaders: ["x-request-id"],
    maxAge: 600,
  });

  // Sessions are cookies, so the parser has to be registered before any route
  // reads one. No secret: cookies here carry an opaque token that is looked up
  // server-side, never signed application state.
  await app.register(cookie);

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onRequest", (request, reply, done) => {
    void reply.header("x-request-id", request.id);
    // Nothing this API returns may be cached by a browser or a proxy.
    void reply.header("cache-control", "no-store");
    done();
  });

  return app;
}
