import { z } from "zod";

/*
  The ledger as an administrator may read it. Read is the whole of it: no
  shape in this file is a request to post, and the routes that serve these
  are all GET. Money moves through LedgerService and nothing else.

  Every amount is an integer count of the asset's smallest unit (one
  millionth of a USDT), carried as a STRING. A JSON number is a double, and a
  double cannot hold every 64-bit integer; a string can, exactly, and no
  client is tempted to do arithmetic on it by accident (AT-21).

  The enumerations mirror the database's, by hand - this package never
  imports the database layer. apps/api has a test that fails if the two
  drift.
*/

export const ledgerAsset = z.enum(["USDT"]);
export type LedgerAsset = z.infer<typeof ledgerAsset>;

export const ledgerAccountType = z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);
export type LedgerAccountType = z.infer<typeof ledgerAccountType>;

export const ledgerAccountScope = z.enum(["USER", "TRADE", "PLATFORM"]);
export type LedgerAccountScope = z.infer<typeof ledgerAccountScope>;

export const ledgerDirection = z.enum(["DEBIT", "CREDIT"]);
export type LedgerDirection = z.infer<typeof ledgerDirection>;

export const ledgerActorType = z.enum(["USER", "ADMIN", "SYSTEM"]);
export type LedgerActorType = z.infer<typeof ledgerActorType>;

/** Why a transaction was posted. One per journal entry in ledger-taxonomy.md. */
export const ledgerReason = z.enum([
  "OPENING_BALANCE",
  "DEPOSIT_CREDITED",
  "SWEEP_BROADCAST",
  "SWEEP_CONFIRMED",
  "UNIDENTIFIED_DEPOSIT_RECEIVED",
  "UNIDENTIFIED_DEPOSIT_ATTRIBUTED",
  "WITHDRAWAL_HELD",
  "WITHDRAWAL_HOLD_RELEASED",
  "WITHDRAWAL_BROADCAST",
  "WITHDRAWAL_CONFIRMED",
  "ESCROW_LOCKED",
  "ESCROW_RELEASED",
  "ESCROW_REFUNDED_EXPIRY",
  "ESCROW_REFUNDED_CANCELLED",
  "DISPUTE_RESOLVED_RELEASE",
  "DISPUTE_RESOLVED_REFUND",
  "RECONCILIATION_SURPLUS_RECORDED",
  "RECONCILIATION_SHORTFALL_WRITTEN_OFF",
]);
export type LedgerReason = z.infer<typeof ledgerReason>;

/** An integer number of millionths, as text. Negative only where the account allows it. */
export const microAmount = z.string().regex(/^-?\d+$/);
export type MicroAmount = z.infer<typeof microAmount>;

/* ---------------------------------------------------------------- accounts */

/** One account with its balance, in the account's natural sense (taxonomy 4). */
export const ledgerAccountSummary = z.object({
  id: z.string(),
  code: z.string(),
  type: ledgerAccountType,
  scope: ledgerAccountScope,
  asset: ledgerAsset,
  /** The user id or trade id the account belongs to; null for the platform's own. */
  ownerId: z.string().nullable(),
  purpose: z.string(),
  balance: microAmount,
  allowsNegative: z.boolean(),
  entryCount: z.number().int().nonnegative(),
  lastTransactionId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LedgerAccountSummary = z.infer<typeof ledgerAccountSummary>;

const pageLimit = z.coerce.number().int().min(1).max(200).default(50);

export const ledgerAccountsQuery = z.object({
  scope: ledgerAccountScope.optional(),
  type: ledgerAccountType.optional(),
  /** Exact owner: one customer's accounts, or one trade's. */
  ownerId: z.string().trim().min(1).max(200).optional(),
  /** Case-insensitive substring of the code. */
  q: z.string().trim().min(1).max(200).optional(),
  /** The last code of the previous page. */
  cursor: z.string().max(400).optional(),
  limit: pageLimit,
});
export type LedgerAccountsQuery = z.input<typeof ledgerAccountsQuery>;
export type LedgerAccountsFilter = z.output<typeof ledgerAccountsQuery>;

export const ledgerAccountsResponse = z.object({
  accounts: z.array(ledgerAccountSummary),
  nextCursor: z.string().nullable(),
});
export type LedgerAccountsResponse = z.infer<typeof ledgerAccountsResponse>;

/** One line of an account's statement: the entry, its transaction, and the balance it left. */
export const ledgerStatementRow = z.object({
  entryId: z.string(),
  transactionId: z.string(),
  createdAt: z.string(),
  reason: ledgerReason,
  referenceType: z.string(),
  referenceId: z.string(),
  direction: ledgerDirection,
  amount: microAmount,
  balanceAfter: microAmount,
});
export type LedgerStatementRow = z.infer<typeof ledgerStatementRow>;

export const ledgerStatementQuery = z.object({
  /** The last entry id of the previous page; the statement runs newest first. */
  before: z.string().max(100).optional(),
  limit: pageLimit,
});
export type LedgerStatementQuery = z.input<typeof ledgerStatementQuery>;
export type LedgerStatementFilter = z.output<typeof ledgerStatementQuery>;

export const ledgerAccountDetail = z.object({
  account: ledgerAccountSummary,
  statement: z.array(ledgerStatementRow),
  nextCursor: z.string().nullable(),
});
export type LedgerAccountDetail = z.infer<typeof ledgerAccountDetail>;

/* ------------------------------------------------------------ transactions */

export const ledgerEntryView = z.object({
  id: z.string(),
  accountId: z.string(),
  accountCode: z.string(),
  direction: ledgerDirection,
  amount: microAmount,
  /** +amount for a debit, -amount for a credit: what the balance check sums. */
  signedAmount: microAmount,
});
export type LedgerEntryView = z.infer<typeof ledgerEntryView>;

export const ledgerTransactionView = z.object({
  id: z.string(),
  createdAt: z.string(),
  asset: ledgerAsset,
  reason: ledgerReason,
  referenceType: z.string(),
  referenceId: z.string(),
  actorType: ledgerActorType,
  actorId: z.string().nullable(),
  correlationId: z.string(),
  idempotencyKey: z.string(),
  reversesTransactionId: z.string().nullable(),
  entries: z.array(ledgerEntryView),
});
export type LedgerTransactionView = z.infer<typeof ledgerTransactionView>;

export const ledgerTransactionsQuery = z.object({
  reason: ledgerReason.optional(),
  referenceType: z.string().trim().min(1).max(100).optional(),
  referenceId: z.string().trim().min(1).max(200).optional(),
  correlationId: z.string().trim().min(1).max(200).optional(),
  /** Only transactions with an entry against this account. */
  accountId: z.string().trim().min(1).max(100).optional(),
  /** The last transaction id of the previous page; the list runs newest first. */
  cursor: z.string().max(100).optional(),
  limit: pageLimit,
});
export type LedgerTransactionsQuery = z.input<typeof ledgerTransactionsQuery>;
export type LedgerTransactionsFilter = z.output<typeof ledgerTransactionsQuery>;

export const ledgerTransactionsResponse = z.object({
  transactions: z.array(ledgerTransactionView),
  nextCursor: z.string().nullable(),
});
export type LedgerTransactionsResponse = z.infer<typeof ledgerTransactionsResponse>;

const ledgerTransactionLink = z.object({
  id: z.string(),
  reason: ledgerReason,
  createdAt: z.string(),
});

/** One transaction in full, with what it undid and what has since undone it. */
export const ledgerTransactionDetail = ledgerTransactionView.extend({
  reverses: ledgerTransactionLink.nullable(),
  reversedBy: z.array(ledgerTransactionLink),
});
export type LedgerTransactionDetail = z.infer<typeof ledgerTransactionDetail>;

/* ---------------------------------------------------------------- overview */

/**
 * The first screen: is the ledger consistent right now, and what does it
 * hold. Every figure here is an aggregate (INTERNAL, not CONFIDENTIAL), which
 * is why this can be shown without naming anybody.
 */
export const ledgerOverview = z.object({
  checkedAt: z.string(),
  health: z.object({
    /** Every transaction sums to zero. False is an incident, not a display state. */
    balanced: z.boolean(),
    unbalancedTransactions: z.number().int().nonnegative(),
    /** Accounts whose projected balance differs from a rebuild of their entries. */
    projectionDrift: z.number().int().nonnegative(),
    /** Accounts below zero that may not be. The constraint makes this impossible; it is checked anyway. */
    floorBreaches: z.number().int().nonnegative(),
  }),
  totals: z.object({
    accounts: z.number().int().nonnegative(),
    transactions: z.number().int().nonnegative(),
    entries: z.number().int().nonnegative(),
    lastPostedAt: z.string().nullable(),
  }),
  /** Balance per account type, natural sense. */
  trialBalance: z.array(
    z.object({
      type: ledgerAccountType,
      accounts: z.number().int().nonnegative(),
      balance: microAmount,
    }),
  ),
  /** Assets + expenses on one side, liabilities + equity + revenue on the other. */
  equation: z.object({
    debitSide: microAmount,
    creditSide: microAmount,
    holds: z.boolean(),
  }),
  platform: z.array(ledgerAccountSummary),
  customers: z.object({
    /** Distinct customers with any ledger account. */
    count: z.number().int().nonnegative(),
    available: microAmount,
    pendingWithdrawal: microAmount,
  }),
  trades: z.object({
    /** Escrow accounts holding anything. */
    open: z.number().int().nonnegative(),
    escrowed: microAmount,
  }),
});
export type LedgerOverview = z.infer<typeof ledgerOverview>;
