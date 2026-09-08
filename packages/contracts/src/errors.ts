import { z } from "zod";

/**
 * Stable, machine-readable error codes. Clients switch on `code`, never on
 * `message`: messages are for humans and may change; codes are a contract.
 */
export const errorCode = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "NOT_READY",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof errorCode>;

export const errorDetail = z.object({
  /** Dot path into the request body, e.g. "amount" or "items.2.quantity". */
  path: z.string(),
  message: z.string(),
});
export type ErrorDetail = z.infer<typeof errorDetail>;

/**
 * The one error envelope every endpoint returns. `correlationId` matches the
 * `x-request-id` response header and the server's log line for the request,
 * so a support ticket can quote it and the log can be found.
 */
export const apiError = z.object({
  error: z.object({
    code: errorCode,
    message: z.string(),
    correlationId: z.string(),
    details: z.array(errorDetail).optional(),
  }),
});
export type ApiError = z.infer<typeof apiError>;
