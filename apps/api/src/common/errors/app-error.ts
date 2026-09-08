import { type ErrorCode, type ErrorDetail } from "@abay/contracts";

/*
  The one error type application code throws. Every AppError maps to a stable
  code from the contracts package, an HTTP status, and a message that is safe
  to show a user. Anything else that escapes a handler is treated as an
  internal error and its message is never sent to the client.
*/
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: readonly ErrorDetail[],
  ) {
    super(message);
    this.name = "AppError";
  }

  static validation(details: readonly ErrorDetail[], message = "The request is not valid.") {
    return new AppError("VALIDATION_FAILED", 400, message, details);
  }

  static unauthenticated(message = "Sign in to continue.") {
    return new AppError("UNAUTHENTICATED", 401, message);
  }

  static forbidden(message = "You do not have access to this.") {
    return new AppError("FORBIDDEN", 403, message);
  }

  static notFound(message = "Not found.") {
    return new AppError("NOT_FOUND", 404, message);
  }

  static conflict(message = "This conflicts with the current state.") {
    return new AppError("CONFLICT", 409, message);
  }

  static rateLimited(message = "Too many requests. Try again shortly.") {
    return new AppError("RATE_LIMITED", 429, message);
  }

  static notReady(message = "The service is not ready.") {
    return new AppError("NOT_READY", 503, message);
  }
}
