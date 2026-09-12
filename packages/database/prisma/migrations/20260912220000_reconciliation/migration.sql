-- Phase 3, stage 4: the differences between the chain and the ledger.
--
-- A reconciliation break is raised by the reconciler, which never posts a
-- correcting entry of its own (ADR-0009); clearing one is a person's act,
-- through the adjustment workflow, with a reason recorded.
-- CreateEnum
CREATE TYPE "break_kind" AS ENUM ('SURPLUS', 'SHORTFALL');

-- CreateEnum
CREATE TYPE "break_status" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "reconciliation_breaks" (
    "id" TEXT NOT NULL,
    "network" "chain_network" NOT NULL,
    "asset" "ledger_asset" NOT NULL,
    "account_code" TEXT NOT NULL,
    "kind" "break_kind" NOT NULL,
    "status" "break_status" NOT NULL DEFAULT 'OPEN',
    "ledger_balance" BIGINT NOT NULL,
    "chain_balance" BIGINT NOT NULL,
    "difference" BIGINT NOT NULL,
    "evidence" JSONB NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolution_reason" TEXT,
    "adjustment_transaction_id" TEXT,
    "correlation_id" TEXT NOT NULL,

    CONSTRAINT "reconciliation_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliation_breaks_status_detected_at_idx" ON "reconciliation_breaks"("status", "detected_at");

-- CreateIndex
CREATE INDEX "reconciliation_breaks_account_code_status_idx" ON "reconciliation_breaks"("account_code", "status");


-- One OPEN break per account. Prisma's schema cannot express a partial unique
-- index, and a plain unique on (account, status) would wrongly allow only one
-- RESOLVED break per account for all time.
CREATE UNIQUE INDEX "reconciliation_breaks_one_open_per_account"
  ON "reconciliation_breaks"("account_code")
  WHERE "status" = 'OPEN';
