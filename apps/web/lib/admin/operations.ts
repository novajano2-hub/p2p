import { z } from "zod";

import { adminRequest, type Result } from "@/lib/admin/client";

/*
  Money in, money out, and the check that holds both against the chain - as
  the administration interface reads and decides them.

  Shapes are re-declared here rather than imported from @abay/contracts, like
  everything in lib/admin/client.ts and lib/admin/ledger.ts, so the browser
  bundle stays independent of the API's build. Every amount is an integer
  string of millionths; lib/admin/money.ts is the only thing that turns one
  into digits.
*/

const money = z.string().regex(/^-?\d+$/);
const network = z.enum(["BSC"]);

/* -------------------------------------------------------------- customers */

const customerSchema = z.object({
  userId: z.string(),
  platformId: z.string(),
  username: z.string(),
  email: z.string(),
  status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]),
  kycStatus: z.enum(["NOT_STARTED", "PENDING", "APPROVED", "REJECTED"]),
});
export type AdminCustomer = z.infer<typeof customerSchema>;

const customerSearchSchema = z.object({
  customers: z.array(customerSchema),
  truncated: z.boolean(),
});

/* --------------------------------------------------------------- deposits */

export const DEPOSIT_STATUSES = [
  "DETECTED",
  "CONFIRMING",
  "CREDITED",
  "ORPHANED",
  "MANUAL_REVIEW",
  "UNATTRIBUTED",
  "REJECTED",
] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

const depositSchema = z.object({
  id: z.string(),
  network,
  txHash: z.string(),
  amount: money,
  status: z.enum(DEPOSIT_STATUSES),
  confirmations: z.number(),
  confirmationsRequired: z.number(),
  detectedAt: z.string(),
  creditedAt: z.string().nullable(),
  logIndex: z.number(),
  blockNumber: z.string(),
  fromAddress: z.string(),
  toAddress: z.string(),
  tokenContract: z.string(),
  rawAmount: z.string(),
  userId: z.string().nullable(),
  customer: customerSchema.nullable(),
  detectedVia: z.string(),
  reviewReason: z.string().nullable(),
  ledgerTransactionId: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionReason: z.string().nullable(),
  correlationId: z.string(),
});
export type AdminDeposit = z.infer<typeof depositSchema>;

const depositQueueSchema = z.object({
  deposits: z.array(depositSchema),
  waiting: z.number(),
});

/* ------------------------------------------------------------ withdrawals */

export const WITHDRAWAL_STATUSES = [
  "REQUESTED",
  "RISK_REVIEW",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "BUILDING",
  "BUILD_FAILED",
  "SIGNING",
  "SIGN_REFUSED",
  "BROADCAST",
  "BROADCAST_UNKNOWN",
  "MANUAL_INVESTIGATION",
  "CONFIRMED",
  "FAILED_CONFIRMED",
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const WITHDRAWAL_STAGES = ["PENDING", "SENDING", "SENT", "RETURNED", "HELD"] as const;
export type WithdrawalStage = (typeof WITHDRAWAL_STAGES)[number];

const approvalSchema = z.object({
  adminId: z.string(),
  adminEmail: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type WithdrawalApproval = z.infer<typeof approvalSchema>;

const withdrawalSchema = z.object({
  id: z.string(),
  network,
  asset: z.string(),
  amount: money,
  fee: money,
  destination: z.string(),
  stage: z.enum(WITHDRAWAL_STAGES),
  status: z.enum(WITHDRAWAL_STATUSES),
  txHash: z.string().nullable(),
  confirmations: z.number(),
  confirmationsRequired: z.number(),
  message: z.string().nullable(),
  requestedAt: z.string(),
  settledAt: z.string().nullable(),
  userId: z.string(),
  customer: customerSchema.nullable(),
  riskScore: z.number().nullable(),
  riskReasons: z.array(z.string()),
  approvalsRequired: z.number(),
  approvals: z.array(approvalSchema),
  providerRef: z.string().nullable(),
  buildAttempts: z.number(),
  failureReason: z.string().nullable(),
  holdTransactionId: z.string().nullable(),
  broadcastTransactionId: z.string().nullable(),
  settledTransactionId: z.string().nullable(),
  correlationId: z.string(),
  broadcastAt: z.string().nullable(),
});
export type AdminWithdrawal = z.infer<typeof withdrawalSchema>;

const withdrawalQueueSchema = z.object({
  review: z.array(withdrawalSchema),
  investigation: z.array(withdrawalSchema),
});

/* --------------------------------------------------------- reconciliation */

export const BREAK_STATUSES = ["OPEN", "RESOLVED", "DISMISSED"] as const;
export type BreakStatus = (typeof BREAK_STATUSES)[number];

const breakSchema = z.object({
  id: z.string(),
  network,
  asset: z.string(),
  accountCode: z.string(),
  kind: z.enum(["SURPLUS", "SHORTFALL"]),
  status: z.enum(BREAK_STATUSES),
  ledgerBalance: money,
  chainBalance: money,
  difference: money,
  detectedAt: z.string(),
  lastSeenAt: z.string(),
  resolvedBy: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolutionReason: z.string().nullable(),
  adjustmentTransactionId: z.string().nullable(),
  correlationId: z.string(),
});
export type ReconciliationBreak = z.infer<typeof breakSchema>;

const breaksSchema = z.object({ breaks: z.array(breakSchema), open: z.number() });

const positionSchema = z.object({
  accountCode: z.string(),
  ledgerBalance: money,
  chainBalance: money,
  difference: money,
  describes: z.string(),
  agrees: z.boolean(),
});
export type ReconciliationPosition = z.infer<typeof positionSchema>;

const reportSchema = z.object({
  checkedAt: z.string(),
  network,
  agrees: z.boolean(),
  positions: z.array(positionSchema),
  breaksOpen: z.number(),
  ledgerAssets: money,
  chainAssets: money,
  inTransit: money,
});
export type ReconciliationReport = z.infer<typeof reportSchema>;

const sweepSchema = z.object({
  id: z.string(),
  network,
  asset: z.string(),
  amount: money,
  status: z.enum(["PENDING", "BROADCAST", "CONFIRMED", "FAILED"]),
  address: z.string(),
  txHash: z.string().nullable(),
  attempts: z.number(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Sweep = z.infer<typeof sweepSchema>;

const sweepsSchema = z.object({ sweeps: z.array(sweepSchema), unswept: money });

/* ------------------------------------------------------------------ calls */

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const get: RequestInit = { method: "GET" };

export const depositsClient = {
  async queue(): Promise<Result<{ deposits: AdminDeposit[]; waiting: number }>> {
    const result = await adminRequest("/deposits/queue", depositQueueSchema, get);
    return result.ok ? { ok: true, ...result.data } : result;
  },

  async one(id: string): Promise<Result<{ deposit: AdminDeposit }>> {
    const result = await adminRequest(`/deposits/${id}`, depositSchema, get);
    return result.ok ? { ok: true, deposit: result.data } : result;
  },

  async approve(id: string, reason: string): Promise<Result<{ deposit: AdminDeposit }>> {
    const result = await adminRequest(
      `/deposits/${id}/approve`,
      depositSchema,
      post(reason ? { reason } : {}),
    );
    return result.ok ? { ok: true, deposit: result.data } : result;
  },

  async reject(id: string, reason: string): Promise<Result<{ deposit: AdminDeposit }>> {
    const result = await adminRequest(`/deposits/${id}/reject`, depositSchema, post({ reason }));
    return result.ok ? { ok: true, deposit: result.data } : result;
  },

  async attribute(
    id: string,
    userId: string,
    reason: string,
  ): Promise<Result<{ deposit: AdminDeposit }>> {
    const result = await adminRequest(
      `/deposits/${id}/attribute`,
      depositSchema,
      post({ userId, reason }),
    );
    return result.ok ? { ok: true, deposit: result.data } : result;
  },
};

export const withdrawalsClient = {
  async queue(): Promise<Result<{ review: AdminWithdrawal[]; investigation: AdminWithdrawal[] }>> {
    const result = await adminRequest("/withdrawals/queue", withdrawalQueueSchema, get);
    return result.ok ? { ok: true, ...result.data } : result;
  },

  async one(id: string): Promise<Result<{ withdrawal: AdminWithdrawal }>> {
    const result = await adminRequest(`/withdrawals/${id}`, withdrawalSchema, get);
    return result.ok ? { ok: true, withdrawal: result.data } : result;
  },

  async approve(id: string, reason: string): Promise<Result<{ withdrawal: AdminWithdrawal }>> {
    const result = await adminRequest(
      `/withdrawals/${id}/approve`,
      withdrawalSchema,
      post(reason ? { reason } : {}),
    );
    return result.ok ? { ok: true, withdrawal: result.data } : result;
  },

  async reject(id: string, reason: string): Promise<Result<{ withdrawal: AdminWithdrawal }>> {
    const result = await adminRequest(
      `/withdrawals/${id}/reject`,
      withdrawalSchema,
      post({ reason }),
    );
    return result.ok ? { ok: true, withdrawal: result.data } : result;
  },

  async resolve(
    id: string,
    input: { outcome: "BROADCAST" | "FAILED"; txHash?: string; reason: string },
  ): Promise<Result<{ withdrawal: AdminWithdrawal }>> {
    const result = await adminRequest(
      `/withdrawals/${id}/investigation`,
      withdrawalSchema,
      post(input),
    );
    return result.ok ? { ok: true, withdrawal: result.data } : result;
  },
};

export const reconciliationClient = {
  async report(): Promise<Result<{ report: ReconciliationReport }>> {
    const result = await adminRequest("/reconciliation/report", reportSchema, get);
    return result.ok ? { ok: true, report: result.data } : result;
  },

  async breaks(
    status?: BreakStatus,
  ): Promise<Result<{ breaks: ReconciliationBreak[]; open: number }>> {
    const result = await adminRequest(
      `/reconciliation/breaks${status ? `?status=${status}` : ""}`,
      breaksSchema,
      get,
    );
    return result.ok ? { ok: true, ...result.data } : result;
  },

  async one(id: string): Promise<Result<{ break: ReconciliationBreak }>> {
    const result = await adminRequest(`/reconciliation/breaks/${id}`, breakSchema, get);
    return result.ok ? { ok: true, break: result.data } : result;
  },

  async resolve(
    id: string,
    input: { action: "RECORD_SURPLUS" | "WRITE_OFF_SHORTFALL" | "DISMISS"; reason: string },
  ): Promise<Result<{ break: ReconciliationBreak }>> {
    const result = await adminRequest(
      `/reconciliation/breaks/${id}/resolve`,
      breakSchema,
      post(input),
    );
    return result.ok ? { ok: true, break: result.data } : result;
  },

  async sweeps(): Promise<Result<{ sweeps: Sweep[]; unswept: string }>> {
    const result = await adminRequest("/reconciliation/sweeps", sweepsSchema, get);
    return result.ok ? { ok: true, ...result.data } : result;
  },
};

export const customersClient = {
  async search(q: string): Promise<Result<{ customers: AdminCustomer[]; truncated: boolean }>> {
    const result = await adminRequest(
      `/customers?q=${encodeURIComponent(q)}`,
      customerSearchSchema,
      get,
    );
    return result.ok ? { ok: true, ...result.data } : result;
  },
};
