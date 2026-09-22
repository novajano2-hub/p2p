import { type IncomingMessage, type ServerResponse } from "node:http";

import { type DynamicModule } from "@nestjs/common";
import { LoggerModule, type Params } from "nestjs-pino";
import pino, { type DestinationStream } from "pino";

import { REDACTED_KEYS } from "@/common/logging/sensitive-fields";
import { type Env } from "@/config/env";

/*
  Structured JSON logs, one line per request, with a correlation id on every
  line written during that request (nestjs-pino carries it through async
  context, so a service three calls deep logs the same id as the request).

  Two layers keep secrets out. The request serializer below is an allowlist:
  a request contributes its id, its method, its path and the caller's
  address, and a response its status - never headers, never a query string,
  never a body. Then redaction by name, for the objects application code
  chooses to log: the names come from sensitive-fields.ts, the classification
  document as code, and are censored before anything is serialised. AT-13
  (test/api/redaction.spec.ts) plants a sentinel in every one of those fields
  and reads the whole stream back, which is what makes both layers a fact
  rather than a convention.
*/

/*
  Every key the registry censors, at every depth a log line realistically
  has. The registry is the list; this only spells out the depths, because
  pino's `*` matches one level and not any number of them.
*/
export const REDACT_PATHS = [
  "req.headers",
  "res.headers",
  ...REDACTED_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`, `*.*.*.${key}`]),
];

/** pino-http's options, as nestjs-pino types them, without the stream forms. */
type PinoHttpOptions = Exclude<
  NonNullable<Params["pinoHttp"]>,
  DestinationStream | readonly unknown[]
>;

/**
 * @param destination where the lines go instead of stdout. The redaction test
 * hands one in and reads every line back; nothing else should.
 */
export function loggingModule(env: Env, destination?: DestinationStream): DynamicModule {
  const pinoHttp: PinoHttpOptions = {
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
    // A stream and a transport are two answers to where the lines go.
    ...(env.NODE_ENV === "development" && !destination
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, singleLine: true, messageKey: "message" },
          },
        }
      : {}),
  };

  return LoggerModule.forRoot({ pinoHttp: destination ? [pinoHttp, destination] : pinoHttp });
}
