import { type ApiError, type ErrorCode, type ErrorDetail } from "@abay/contracts";
import { HttpException } from "@nestjs/common";
import { ZodError } from "zod";

import { AppError } from "./app-error";

/*
  Turns whatever escaped a handler into the one error envelope every endpoint
  returns. Pure: no logging, no framework objects, so the mapping is unit
  tested on its own and reused by both the Nest exception filter and the
  Fastify error handler that catches errors raised before a handler runs
  (a malformed JSON body, a request too large).
*/

export const INTERNAL_ERROR_MESSAGE =
  "Something went wrong on our side. Quote the correlation ID if you contact support.";

const STATUS_TO_CODE: Readonly<Record<number, ErrorCode>> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "VALIDATION_FAILED",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
  503: "NOT_READY",
};

export interface ErrorResponse {
  status: number;
  body: ApiError;
  /** True when the original error should be logged at error level with its stack. */
  unexpected: boolean;
}

function envelope(
  code: ErrorCode,
  message: string,
  correlationId: string,
  details?: readonly ErrorDetail[],
): ApiError {
  return {
    error: {
      code,
      message,
      correlationId,
      ...(details && details.length > 0 ? { details: [...details] } : {}),
    },
  };
}

function messageOf(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === "string") return response;
  if (typeof response === "object" && "message" in response) {
    const { message } = response;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.map(String).join("; ");
  }
  return exception.message;
}

/** Errors Fastify raises itself, before a Nest handler is reached. */
function isFastifyError(value: unknown): value is Error & { statusCode: number; code: string } {
  if (!(value instanceof Error)) return false;
  const candidate = value as Error & { statusCode?: unknown; code?: unknown };
  return (
    typeof candidate.statusCode === "number" &&
    typeof candidate.code === "string" &&
    candidate.code.startsWith("FST_")
  );
}

export function toErrorResponse(exception: unknown, correlationId: string): ErrorResponse {
  if (exception instanceof AppError) {
    return {
      status: exception.status,
      body: envelope(exception.code, exception.message, correlationId, exception.details),
      unexpected: exception.status >= 500,
    };
  }

  if (exception instanceof ZodError) {
    const details = exception.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
    return {
      status: 400,
      body: envelope("VALIDATION_FAILED", "The request is not valid.", correlationId, details),
      unexpected: false,
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = STATUS_TO_CODE[status] ?? "INTERNAL";
    const message = status < 500 ? messageOf(exception) : INTERNAL_ERROR_MESSAGE;
    return { status, body: envelope(code, message, correlationId), unexpected: status >= 500 };
  }

  if (isFastifyError(exception)) {
    const status = exception.statusCode;
    const code = STATUS_TO_CODE[status] ?? "INTERNAL";
    const message = status < 500 ? exception.message : INTERNAL_ERROR_MESSAGE;
    return { status, body: envelope(code, message, correlationId), unexpected: status >= 500 };
  }

  return {
    status: 500,
    body: envelope("INTERNAL", INTERNAL_ERROR_MESSAGE, correlationId),
    unexpected: true,
  };
}
