import { type IncomingMessage, type ServerResponse } from "node:http";

import { type DynamicModule } from "@nestjs/common";
import { LoggerModule, type Params } from "nestjs-pino";
import pino from "pino";

import { type Env } from "@/config/env";

/*
  Structured JSON logs, one line per request, with a correlation id on every
  line written during that request (nestjs-pino carries it through async
  context, so a service three calls deep logs the same id as the request).

  Redaction is by path, applied before anything is serialised. The request
  serializer also drops headers and query strings wholesale: a bearer token in
  a query string is a classic leak and there is no legitimate reason for this
  API to log either.
*/

/** Keys that must never reach a log, at the depths they realistically appear. */
const SENSITIVE_KEYS = [
  "password",
  "newPassword",
  "currentPassword",
  "passwordHash",
  "token",
  "refreshToken",
  "sessionToken",
  "secret",
  "apiKey",
  "otp",
  "verificationCode",
  "paymentInstructions",
  "accountNumber",
];

export const REDACT_PATHS = [
  "req.headers",
  "res.headers",
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`, `*.*.*.${key}`]),
];

export function loggingModule(env: Env): DynamicModule {
  const pinoHttp: Params["pinoHttp"] = {
    level: env.LOG_LEVEL,
    messageKey: "message",
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    customProps: (req) => ({ correlationId: req.id }),
    // Probes are noise. Everything else is logged.
    autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/ready" },
    serializers: {
      req(req: IncomingMessage) {
        const serialized = pino.stdSerializers.req(req);
        return {
          id: serialized.id,
          method: serialized.method,
          // Path only. Query strings are dropped, never redacted.
          url: serialized.url.split("?")[0],
          remoteAddress: serialized.remoteAddress,
        };
      },
      res(res: ServerResponse) {
        return { statusCode: res.statusCode };
      },
      err: pino.stdSerializers.err,
    },
    ...(env.NODE_ENV === "development"
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, singleLine: true, messageKey: "message" },
          },
        }
      : {}),
  };

  return LoggerModule.forRoot({ pinoHttp });
}
