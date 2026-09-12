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

  /*
    A cookie-authenticated mutation that cannot be shown to have come from our
    own pages. 403 rather than 401: the caller is authenticated, and repeating
    the request with the same credentials will not help. The message says what
    to do, because the one legitimate way to see this is a page that has been
    open across a change of session.
  */
  static csrfFailed(
    message = "That request could not be verified. Reload the page and try again.",
  ) {
    return new AppError("CSRF_FAILED", 403, message);
  }

  /*
    401, same as a wrong password, because the request has not authenticated -
    but its own code, because the client's next move is different: ask the
    person for six digits and repeat, not tell them their password was wrong.
  */
  static mfaRequired(message = "Enter the 6-digit code from your authenticator app.") {
    return new AppError("MFA_REQUIRED", 401, message);
  }

  static notFound(message = "Not found.") {
    return new AppError("NOT_FOUND", 404, message);
  }

  static conflict(message = "This conflicts with the current state.") {
    return new AppError("CONFLICT", 409, message);
  }

  /*
    409: the request was well formed and the account is real; what it asked
    for is not possible against the balance as it stands right now. The
    amount available is deliberately not in the message - the caller who is
    entitled to know reads it from the balance, and anyone else does not.
  */
  static insufficientFunds(message = "There is not enough in this account to do that.") {
    return new AppError("INSUFFICIENT_FUNDS", 409, message);
  }

  static rateLimited(message = "Too many requests. Try again shortly.") {
    return new AppError("RATE_LIMITED", 429, message);
  }

  static notReady(message = "The service is not ready.") {
    return new AppError("NOT_READY", 503, message);
  }
}
