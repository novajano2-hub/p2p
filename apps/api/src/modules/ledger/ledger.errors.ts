import { AppError } from "@/common/errors/app-error";

/*
  The ways a posting can be refused after validation passed: by the balance,
  by a key already spent, or by a chart of accounts that does not have what
  was asked for. Each is an AppError so it reaches a client as the stable
  envelope with the right status, and each carries what a caller needs to
  respond - the account, the key - as fields rather than parsed out of prose.
*/

/** The debited account does not hold enough. Raised while its row is locked, so it is final. */
export class InsufficientFundsError extends AppError {
  constructor(readonly accountCode: string) {
    super("INSUFFICIENT_FUNDS", 409, "There is not enough in this account to do that.");
    this.name = "InsufficientFundsError";
  }
}

/**
 * The idempotency key was seen before, attached to a DIFFERENT posting. A
 * retry of the same posting is not an error and never reaches here; this is
 * a caller reusing a key for a new event, which is a bug worth stopping.
 */
export class IdempotencyConflictError extends AppError {
  constructor(
    readonly idempotencyKey: string,
    readonly existingTransactionId: string,
  ) {
    super(
      "CONFLICT",
      409,
      "That idempotency key already belongs to a different ledger transaction.",
    );
    this.name = "IdempotencyConflictError";
  }
}

/**
 * A PLATFORM account that the chart of accounts does not contain. Not an
 * AppError: platform accounts are seeded by migration and never created on
 * the fly, so asking for one that is missing is a programming error or a
 * database that was not migrated, and either deserves a 500 and a stack.
 */
export class UnknownPlatformAccountError extends Error {
  constructor(readonly code: string) {
    super(
      `Platform account "${code}" does not exist. Platform accounts are seeded by migration ` +
        "(packages/database/sql/ledger-chart-of-accounts.sql), never created at runtime.",
    );
    this.name = "UnknownPlatformAccountError";
  }
}
