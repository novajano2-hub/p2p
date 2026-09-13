import { z } from "zod";

import { send, type Failure } from "@/lib/auth/client";

/*
  The wallet's own calls: the address money arrives at, the balances, and the
  two lists that say where money in flight has got to.

  Shapes are re-declared here rather than imported from @abay/contracts, as
  everywhere else in this app, so the browser bundle stays independent of the
  API's build. Every amount is an integer string of millionths and is handed
  to lib/money.ts to become digits; no screen below this line sees a number.

  It shares lib/auth/client.ts's request helper rather than having its own,
  because the CSRF token the API issues lives in that module - a second copy
  would hold a token it never receives and every write would be refused.
*/

const money = z.string().regex(/^-?\d+$/);

export type Result<T> = ({ ok: true } & T) | Failure;

/* ------------------------------------------------------------------ where */

const addressSchema = z.object({
  network: z.string(),
  standard: z.string(),
  asset: z.string(),
  address: z.string(),
  confirmationsRequired: z.number(),
  minimumDeposit: money,
});
export type DepositAddress = z.infer<typeof addressSchema>;

const balanceSchema = z.object({
  asset: z.string(),
  available: money,
  escrowed: money,
  pendingWithdrawal: money,
  total: money,
});
export type WalletBalance = z.infer<typeof balanceSchema>;

/* --------------------------------------------------------------- in flight */

export const DEPOSIT_STATUSES = [
  "DETECTED",
  "CONFIRMING",
  "CREDITED",
  "ORPHANED",
  "MANUAL_REVIEW",
  "UNATTRIBUTED",
  "REJECTED",
] as const;

const depositSchema = z.object({
  id: z.string(),
  network: z.string(),
  txHash: z.string(),
  amount: money,
  status: z.enum(DEPOSIT_STATUSES),
  confirmations: z.number(),
  confirmationsRequired: z.number(),
  detectedAt: z.string(),
  creditedAt: z.string().nullable(),
});
export type Deposit = z.infer<typeof depositSchema>;

export const WITHDRAWAL_STAGES = ["PENDING", "SENDING", "SENT", "RETURNED", "HELD"] as const;
export type WithdrawalStage = (typeof WITHDRAWAL_STAGES)[number];

const withdrawalSchema = z.object({
  id: z.string(),
  network: z.string(),
  asset: z.string(),
  amount: money,
  fee: money,
  destination: z.string(),
  stage: z.enum(WITHDRAWAL_STAGES),
  txHash: z.string().nullable(),
  confirmations: z.number(),
  confirmationsRequired: z.number(),
  message: z.string().nullable(),
  /** The server's own answer, never inferred from the stage. */
  cancellable: z.boolean(),
  requestedAt: z.string(),
  settledAt: z.string().nullable(),
});
export type Withdrawal = z.infer<typeof withdrawalSchema>;

const limitsSchema = z.object({
  network: z.string(),
  asset: z.string(),
  minimum: money,
  maximum: money,
  dailyMaximum: money,
  dailyRemaining: money,
  available: money,
  fee: money,
});
export type WithdrawalLimits = z.infer<typeof limitsSchema>;

const depositsSchema = z.object({ deposits: z.array(depositSchema) });
const withdrawalsSchema = z.object({ withdrawals: z.array(withdrawalSchema) });

/* ------------------------------------------------------------------ calls */

const GET: RequestInit = { method: "GET" };

export const walletClient = {
  async address(): Promise<Result<{ address: DepositAddress }>> {
    const result = await send("/v1/wallet/deposit-address", addressSchema, GET);
    return result.ok ? { ok: true, address: result.data } : result;
  },

  async balance(): Promise<Result<{ balance: WalletBalance }>> {
    const result = await send("/v1/wallet/balance", balanceSchema, GET);
    return result.ok ? { ok: true, balance: result.data } : result;
  },

  async deposits(): Promise<Result<{ deposits: Deposit[] }>> {
    const result = await send("/v1/wallet/deposits", depositsSchema, GET);
    return result.ok ? { ok: true, deposits: result.data.deposits } : result;
  },

  async withdrawals(): Promise<Result<{ withdrawals: Withdrawal[] }>> {
    const result = await send("/v1/wallet/withdrawals", withdrawalsSchema, GET);
    return result.ok ? { ok: true, withdrawals: result.data.withdrawals } : result;
  },

  async limits(): Promise<Result<{ limits: WithdrawalLimits }>> {
    const result = await send("/v1/wallet/withdrawals/limits", limitsSchema, GET);
    return result.ok ? { ok: true, limits: result.data } : result;
  },

  /*
    Sending money out. The Idempotency-Key is generated here and held by the
    caller across retries (ADR-0007): a reply lost to a flaky connection must
    resolve to the same withdrawal when the button is pressed again, never to
    a second one. The password goes in the body because a session cookie
    alone must not be able to move money off the platform.
  */
  async withdraw(input: {
    network: string;
    /** Millionths, as an integer string. Never a number. */
    amount: string;
    destination: string;
    password: string;
    idempotencyKey: string;
  }): Promise<Result<{ withdrawal: Withdrawal }>> {
    const { idempotencyKey, ...body } = input;
    const result = await send("/v1/wallet/withdrawals", withdrawalSchema, {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
    });
    return result.ok ? { ok: true, withdrawal: result.data } : result;
  },

  async cancel(id: string): Promise<Result<{ withdrawal: Withdrawal }>> {
    const result = await send(`/v1/wallet/withdrawals/${id}/cancel`, withdrawalSchema, {
      method: "POST",
      body: JSON.stringify({}),
    });
    return result.ok ? { ok: true, withdrawal: result.data } : result;
  },
};

/** A fresh key per attempt-series, kept by the form across retries of the same attempt. */
export const newIdempotencyKey = (): string => crypto.randomUUID();
