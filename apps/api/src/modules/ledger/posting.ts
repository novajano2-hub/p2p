import {
  type LedgerAccountType,
  type LedgerActorType,
  type LedgerAsset,
  type LedgerDirection,
  type LedgerReason,
} from "@abay/database";

import { AppError } from "@/common/errors/app-error";
import { type AccountDescriptor, parseAccountCode } from "@/modules/ledger/account-code";

/*
  What a caller hands LedgerService, and everything that can be checked about
  it before a single row is touched.

  The database is the guarantee (stage 1): it will refuse an unbalanced
  transaction at COMMIT whatever this file says. This file exists so that the
  ordinary mistake - a caller that got a sign backwards - is refused in a
  microsecond with a message naming the line, rather than after locks were
  taken and rows written, with a message naming a trigger.
*/

export interface PostingLine {
  /** An account code, from account-code.ts. Never an id. */
  account: string;
  direction: LedgerDirection;
  /** Micro-units of the asset, non-negative. Zero is allowed (taxonomy JE-4). */
  amount: bigint;
}

export interface PostingRequest {
  reason: LedgerReason;
  asset: LedgerAsset;
  /** The business object this movement belongs to: a deposit, a trade, a withdrawal. */
  reference: { type: string; id: string };
  /** Who caused it. SYSTEM carries no id; USER and ADMIN must. */
  actor: { type: LedgerActorType; id?: string | null | undefined };
  correlationId: string;
  /**
   * Unique per business event: "deposit:{id}:credit", "trade:{id}:lock". A
   * second posting with the same key and the same lines is answered with the
   * first one; the same key with different lines is a conflict.
   */
  idempotencyKey: string;
  /** The transaction this one undoes, for a refund or a released hold. */
  reversesTransactionId?: string | undefined;
  lines: readonly PostingLine[];
}

/** A line the service can work with: parsed, signed, and known to be well formed. */
export interface ValidatedLine extends PostingLine {
  descriptor: AccountDescriptor;
  /** amount for a debit, -amount for a credit: the column the database sums. */
  signedAmount: bigint;
}

export interface ValidatedPosting extends Omit<PostingRequest, "lines"> {
  lines: readonly ValidatedLine[];
}

/** A posting that cannot be right, refused before any I/O, naming what is wrong. */
export class LedgerPostingError extends AppError {
  constructor(problems: readonly { path: string; message: string }[]) {
    super("VALIDATION_FAILED", 400, "That ledger posting is not valid.", problems);
    this.name = "LedgerPostingError";
  }
}

export const signedAmount = (direction: LedgerDirection, amount: bigint): bigint =>
  direction === "DEBIT" ? amount : -amount;

/**
 * How much an entry moves the account's balance, in the account's NATURAL
 * sense - the same arithmetic as the balance trigger in
 * packages/database/sql/ledger-balance-projection.sql, and the test for this
 * module pins the two to each other. A debit raises an asset or an expense
 * and lowers everything else; a credit does the opposite.
 */
export function naturalDelta(
  type: LedgerAccountType,
  direction: LedgerDirection,
  amount: bigint,
): bigint {
  const signed = signedAmount(direction, amount);
  return type === "ASSET" || type === "EXPENSE" ? signed : -signed;
}

export function validatePosting(request: PostingRequest): ValidatedPosting {
  const problems: { path: string; message: string }[] = [];
  const fail = (path: string, message: string) => problems.push({ path, message });

  if (!request.correlationId) fail("correlationId", "required");
  if (!request.idempotencyKey) fail("idempotencyKey", "required");
  if (!request.reference.type) fail("reference.type", "required");
  if (!request.reference.id) fail("reference.id", "required");

  if (request.actor.type === "SYSTEM") {
    if (request.actor.id) fail("actor.id", "a SYSTEM actor carries no id");
  } else if (!request.actor.id) {
    fail("actor.id", `a ${request.actor.type} actor needs an id`);
  }

  if (request.lines.length < 2) {
    fail("lines", "a journal entry needs at least two lines");
  }

  const lines: ValidatedLine[] = [];
  let net = 0n;
  request.lines.forEach((line, index) => {
    const path = `lines.${index}`;
    if (typeof line.amount !== "bigint") {
      fail(`${path}.amount`, "must be a bigint of micro-units, never a number");
      return;
    }
    if (line.amount < 0n) {
      fail(`${path}.amount`, "must not be negative; the direction carries the sense");
      return;
    }

    let descriptor: AccountDescriptor;
    try {
      descriptor = parseAccountCode(line.account);
    } catch (error) {
      fail(`${path}.account`, error instanceof Error ? error.message : "invalid account code");
      return;
    }
    // Compared as strings on purpose: with one asset in the enum, TypeScript
    // narrows both sides of a direct comparison to never inside the branch.
    const lineAsset: string = descriptor.asset;
    const postingAsset: string = request.asset;
    if (lineAsset !== postingAsset) {
      fail(
        `${path}.account`,
        `is a ${lineAsset} account in a ${postingAsset} transaction (one asset per transaction)`,
      );
      return;
    }

    const signed = signedAmount(line.direction, line.amount);
    net += signed;
    lines.push({ ...line, descriptor, signedAmount: signed });
  });

  if (problems.length === 0 && net !== 0n) {
    fail("lines", `debits and credits differ by ${net.toString()} micro-units`);
  }

  if (problems.length > 0) throw new LedgerPostingError(problems);

  return { ...request, lines };
}
