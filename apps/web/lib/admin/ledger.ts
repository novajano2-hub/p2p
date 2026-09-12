import { z } from "zod";

import { adminRequest, type Result } from "@/lib/admin/client";

/*
  The ledger, as the admin interface reads it. Read only: this module has no
  method that posts, and the API has no route under /admin/ledger that does.

  Shapes are re-declared here, like everything in lib/admin/client.ts, so the
  browser bundle stays independent of the API's build. Every amount is an
  integer string of millionths - see lib/admin/money.ts for why, and for the
  one function that turns it into digits.
*/

export type LedgerAccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
export type LedgerScope = "USER" | "TRADE" | "PLATFORM";
export type LedgerDirection = "DEBIT" | "CREDIT";

export const LEDGER_REASONS = [
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
] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

const accountType = z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);
const scope = z.enum(["USER", "TRADE", "PLATFORM"]);
const direction = z.enum(["DEBIT", "CREDIT"]);
const reason = z.enum(LEDGER_REASONS);
const money = z.string().regex(/^-?\d+$/);

const accountSchema = z.object({
  id: z.string(),
  code: z.string(),
  type: accountType,
  scope,
  asset: z.string(),
  ownerId: z.string().nullable(),
  purpose: z.string(),
  balance: money,
  allowsNegative: z.boolean(),
  entryCount: z.number(),
  lastTransactionId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LedgerAccount = z.infer<typeof accountSchema>;

const accountsSchema = z.object({
  accounts: z.array(accountSchema),
  nextCursor: z.string().nullable(),
});

const statementRowSchema = z.object({
  entryId: z.string(),
  transactionId: z.string(),
  createdAt: z.string(),
  reason,
  referenceType: z.string(),
  referenceId: z.string(),
  direction,
  amount: money,
  balanceAfter: money,
});
export type LedgerStatementRow = z.infer<typeof statementRowSchema>;

const statementSchema = z.object({
  statement: z.array(statementRowSchema),
  nextCursor: z.string().nullable(),
});
const accountDetailSchema = statementSchema.extend({ account: accountSchema });

const entrySchema = z.object({
  id: z.string(),
  accountId: z.string(),
  accountCode: z.string(),
  direction,
  amount: money,
  signedAmount: money,
});
export type LedgerEntry = z.infer<typeof entrySchema>;

const transactionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  asset: z.string(),
  reason,
  referenceType: z.string(),
  referenceId: z.string(),
  actorType: z.enum(["USER", "ADMIN", "SYSTEM"]),
  actorId: z.string().nullable(),
  correlationId: z.string(),
  idempotencyKey: z.string(),
  reversesTransactionId: z.string().nullable(),
  entries: z.array(entrySchema),
});
export type LedgerTransaction = z.infer<typeof transactionSchema>;

const linkSchema = z.object({ id: z.string(), reason, createdAt: z.string() });
const transactionDetailSchema = transactionSchema.extend({
  reverses: linkSchema.nullable(),
  reversedBy: z.array(linkSchema),
});
export type LedgerTransactionDetail = z.infer<typeof transactionDetailSchema>;

const transactionsSchema = z.object({
  transactions: z.array(transactionSchema),
  nextCursor: z.string().nullable(),
});

const overviewSchema = z.object({
  checkedAt: z.string(),
  health: z.object({
    balanced: z.boolean(),
    unbalancedTransactions: z.number(),
    projectionDrift: z.number(),
    floorBreaches: z.number(),
  }),
  totals: z.object({
    accounts: z.number(),
    transactions: z.number(),
    entries: z.number(),
    lastPostedAt: z.string().nullable(),
  }),
  trialBalance: z.array(z.object({ type: accountType, accounts: z.number(), balance: money })),
  equation: z.object({ debitSide: money, creditSide: money, holds: z.boolean() }),
  platform: z.array(accountSchema),
  customers: z.object({ count: z.number(), available: money, pendingWithdrawal: money }),
  trades: z.object({ open: z.number(), escrowed: money }),
});
export type LedgerOverview = z.infer<typeof overviewSchema>;

export type AccountsFilter = {
  scope?: LedgerScope | undefined;
  type?: LedgerAccountType | undefined;
  ownerId?: string | undefined;
  q?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
};

export type TransactionsFilter = {
  reason?: LedgerReason | undefined;
  referenceType?: string | undefined;
  referenceId?: string | undefined;
  correlationId?: string | undefined;
  accountId?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
};

/** Only the filters that are set go on the wire; an empty string is "not set". */
function query(filter: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export const ledgerClient = {
  async overview(): Promise<Result<{ overview: LedgerOverview }>> {
    const result = await adminRequest("/ledger/overview", overviewSchema, { method: "GET" });
    return result.ok ? { ok: true, overview: result.data } : result;
  },

  async accounts(
    filter: AccountsFilter,
  ): Promise<Result<{ accounts: LedgerAccount[]; nextCursor: string | null }>> {
    const result = await adminRequest(`/ledger/accounts${query(filter)}`, accountsSchema, {
      method: "GET",
    });
    return result.ok ? { ok: true, ...result.data } : result;
  },

  async account(
    id: string,
  ): Promise<
    Result<{ account: LedgerAccount; statement: LedgerStatementRow[]; nextCursor: string | null }>
  > {
    const result = await adminRequest(`/ledger/accounts/${id}`, accountDetailSchema, {
      method: "GET",
    });
    return result.ok ? { ok: true, ...result.data } : result;
  },

  async statement(
    id: string,
    filter: { before?: string | undefined; limit?: number | undefined },
  ): Promise<Result<{ statement: LedgerStatementRow[]; nextCursor: string | null }>> {
    const result = await adminRequest(
      `/ledger/accounts/${id}/statement${query(filter)}`,
      statementSchema,
      { method: "GET" },
    );
    return result.ok ? { ok: true, ...result.data } : result;
  },

  async transactions(
    filter: TransactionsFilter,
  ): Promise<Result<{ transactions: LedgerTransaction[]; nextCursor: string | null }>> {
    const result = await adminRequest(`/ledger/transactions${query(filter)}`, transactionsSchema, {
      method: "GET",
    });
    return result.ok ? { ok: true, ...result.data } : result;
  },

  async transaction(id: string): Promise<Result<{ transaction: LedgerTransactionDetail }>> {
    const result = await adminRequest(`/ledger/transactions/${id}`, transactionDetailSchema, {
      method: "GET",
    });
    return result.ok ? { ok: true, transaction: result.data } : result;
  },
};
