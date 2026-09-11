import { type IncomingMessage } from "node:http";

import { KYC_IMAGE_MAX_BYTES, KYC_IMAGE_TYPES } from "@abay/contracts";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";

import { AppModule } from "@/app.module";
import { AppExceptionFilter } from "@/common/errors/app-exception.filter";
import { RateLimitGuard } from "@/common/rate-limit/rate-limit.guard";
import { requestIdFrom } from "@/common/request-id";
import { CSRF_HEADER } from "@/common/security/csrf";
import { OriginGuard } from "@/common/security/origin.guard";
import { type Env } from "@/config/env";

/** Hard cap on JSON request bodies. Photographs get their own, larger limit below. */
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

  /*
    Two checks in front of every route, in this order for a reason.

    OriginGuard is pure header comparison and costs nothing, so a forged
    cross-site request is turned away before anything else looks at it.

    RateLimitGuard is next, and before the auth guards on purpose: a flood
    should not get to spend a database round trip resolving a session first. It
    does nothing at all on a route that has not declared a limit.

    The second half of CSRF - the token - lives inside SessionGuard and
    AdminGuard rather than here, because "cookie-authenticated mutation" is
    precisely the set of requests those two admit. See common/security/csrf.ts.
  */
  app.useGlobalGuards(app.get(OriginGuard), app.get(RateLimitGuard));

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
    allowedHeaders: ["content-type", "x-request-id", CSRF_HEADER, "idempotency-key"],
    /*
      Read by script, so each has to be named: a browser hides every other
      response header from a cross-origin caller. The CSRF token is delivered
      this way, and retry-after is how a client knows how long a rate limit has
      left to run rather than guessing.
    */
    exposedHeaders: ["x-request-id", CSRF_HEADER, "retry-after"],
    maxAge: 600,
  });

  // Sessions are cookies, so the parser has to be registered before any route
  // reads one. No secret: cookies here carry an opaque token that is looked up
  // server-side, never signed application state.
  await app.register(cookie);

  const fastify = app.getHttpAdapter().getInstance();

  /*
    Photographs of identity documents arrive as the raw image, one per
    request, under the image's own content type. Each type gets its own
    parser with its own limit, so the cap on JSON above stays where it is.
    The handler checks what the bytes really are; the header is never trusted.
  */
  for (const type of KYC_IMAGE_TYPES) {
    fastify.addContentTypeParser(
      type,
      { parseAs: "buffer", bodyLimit: KYC_IMAGE_MAX_BYTES },
      (_request, body, done) => {
        done(null, body);
      },
    );
  }

  fastify.addHook("onRequest", (request, reply, done) => {
    void reply.header("x-request-id", request.id);
    // Nothing this API returns may be cached by a browser or a proxy.
    void reply.header("cache-control", "no-store");
    done();
  });

  return app;
}
