-- Phase 4, stage 1: the marketplace.
--
-- Payment methods (instructions encrypted at field level, data-classification
-- RESTRICTED), offers, and the tables the later stages fill: trades and their
-- per-trade escrow reference, the trade timeline, the chat, disputes and
-- their evidence, and the trader statistics the marketplace shows. Generated
-- from schema.prisma with `prisma migrate diff`; the CHECK constraints at the
-- end are written by hand, because Prisma cannot express them and the
-- database is the thing that must refuse an impossible offer or trade even
-- when the application is wrong (state-machines.md 4).
-- CreateEnum
CREATE TYPE "payment_method_kind" AS ENUM ('TELEBIRR', 'CBE_BIRR', 'MPESA', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "payment_method_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "offer_side" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "offer_status" AS ENUM ('ACTIVE', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "trade_status" AS ENUM ('AWAITING_FIAT_PAYMENT', 'BUYER_MARKED_PAID', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DISPUTED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "trade_event_kind" AS ENUM ('CREATED', 'MARKED_PAID', 'CANCELLED', 'EXPIRED', 'RELEASED', 'DISPUTE_OPENED', 'DISPUTE_WITHDRAWN', 'DISPUTE_RESOLVED');

-- CreateEnum
CREATE TYPE "trade_message_kind" AS ENUM ('TEXT', 'IMAGE');

-- CreateEnum
CREATE TYPE "dispute_status" AS ENUM ('OPEN', 'WITHDRAWN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "dispute_reason" AS ENUM ('PAYMENT_NOT_RECEIVED', 'PAYMENT_NOT_RELEASED', 'WRONG_AMOUNT', 'THIRD_PARTY_PAYMENT', 'SUSPECTED_FRAUD', 'OTHER');

-- CreateEnum
CREATE TYPE "dispute_outcome" AS ENUM ('RELEASE_TO_BUYER', 'REFUND_TO_SELLER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notification_type" ADD VALUE 'TRADE_OPENED';
ALTER TYPE "notification_type" ADD VALUE 'TRADE_PAID';
ALTER TYPE "notification_type" ADD VALUE 'TRADE_RELEASED';
ALTER TYPE "notification_type" ADD VALUE 'TRADE_CANCELLED';
ALTER TYPE "notification_type" ADD VALUE 'TRADE_EXPIRED';
ALTER TYPE "notification_type" ADD VALUE 'DISPUTE_OPENED';
ALTER TYPE "notification_type" ADD VALUE 'DISPUTE_RESOLVED';

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "payment_method_kind" NOT NULL,
    "bank_code" TEXT,
    "label" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "details_encrypted" TEXT NOT NULL,
    "status" "payment_method_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "side" "offer_side" NOT NULL,
    "asset" "ledger_asset" NOT NULL,
    "fiat" TEXT NOT NULL DEFAULT 'ETB',
    "price_santim" BIGINT NOT NULL,
    "total_amount" BIGINT NOT NULL,
    "remaining_amount" BIGINT NOT NULL,
    "min_santim" BIGINT NOT NULL,
    "max_santim" BIGINT NOT NULL,
    "payment_window_minutes" INTEGER NOT NULL,
    "terms" TEXT,
    "auto_reply" TEXT,
    "require_verified" BOOLEAN NOT NULL DEFAULT false,
    "min_completed_trades" INTEGER NOT NULL DEFAULT 0,
    "status" "offer_status" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_payment_methods" (
    "id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "kind" "payment_method_kind" NOT NULL,
    "payment_method_id" TEXT,

    CONSTRAINT "offer_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "offer_side" "offer_side" NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "asset" "ledger_asset" NOT NULL,
    "amount" BIGINT NOT NULL,
    "fee" BIGINT NOT NULL DEFAULT 0,
    "fiat" TEXT NOT NULL DEFAULT 'ETB',
    "price_santim" BIGINT NOT NULL,
    "fiat_santim" BIGINT NOT NULL,
    "payment_method_id" TEXT,
    "payment_kind" "payment_method_kind" NOT NULL,
    "payment_label" TEXT NOT NULL,
    "payment_snapshot_encrypted" TEXT NOT NULL,
    "status" "trade_status" NOT NULL DEFAULT 'AWAITING_FIAT_PAYMENT',
    "payment_deadline" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "close_reason" TEXT,
    "escrow_transaction_id" TEXT,
    "settlement_transaction_id" TEXT,
    "chat_seq" INTEGER NOT NULL DEFAULT 0,
    "client_key" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_events" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "kind" "trade_event_kind" NOT NULL,
    "actor_user_id" TEXT,
    "actor_admin_id" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_messages" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "sender_id" TEXT NOT NULL,
    "kind" "trade_message_kind" NOT NULL,
    "body" TEXT,
    "storage_key" TEXT,
    "content_type" TEXT,
    "size_bytes" INTEGER,
    "client_message_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_chat_reads" (
    "trade_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "last_read_seq" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_chat_reads_pkey" PRIMARY KEY ("trade_id","user_id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "opened_by_id" TEXT NOT NULL,
    "reason" "dispute_reason" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "dispute_status" NOT NULL DEFAULT 'OPEN',
    "outcome" "dispute_outcome",
    "resolved_by_id" TEXT,
    "resolved_by_email" TEXT,
    "resolution_note" TEXT,
    "resolved_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "correlation_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_evidence" (
    "id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trader_stats" (
    "user_id" TEXT NOT NULL,
    "trades_total" INTEGER NOT NULL DEFAULT 0,
    "trades_completed" INTEGER NOT NULL DEFAULT 0,
    "trades_failed" INTEGER NOT NULL DEFAULT 0,
    "release_total_ms" BIGINT NOT NULL DEFAULT 0,
    "release_count" INTEGER NOT NULL DEFAULT 0,
    "pay_total_ms" BIGINT NOT NULL DEFAULT 0,
    "pay_count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trader_stats_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "payment_methods_user_id_status_idx" ON "payment_methods"("user_id", "status");

-- CreateIndex
CREATE INDEX "offers_status_side_price_santim_idx" ON "offers"("status", "side", "price_santim");

-- CreateIndex
CREATE INDEX "offers_user_id_status_idx" ON "offers"("user_id", "status");

-- CreateIndex
CREATE INDEX "offer_payment_methods_offer_id_idx" ON "offer_payment_methods"("offer_id");

-- CreateIndex
CREATE INDEX "offer_payment_methods_payment_method_id_idx" ON "offer_payment_methods"("payment_method_id");

-- CreateIndex
CREATE INDEX "trades_buyer_id_createdAt_idx" ON "trades"("buyer_id", "createdAt");

-- CreateIndex
CREATE INDEX "trades_seller_id_createdAt_idx" ON "trades"("seller_id", "createdAt");

-- CreateIndex
CREATE INDEX "trades_status_payment_deadline_idx" ON "trades"("status", "payment_deadline");

-- CreateIndex
CREATE INDEX "trades_offer_id_status_idx" ON "trades"("offer_id", "status");

-- CreateIndex
CREATE INDEX "trades_correlation_id_idx" ON "trades"("correlation_id");

-- CreateIndex
CREATE INDEX "trade_events_trade_id_createdAt_idx" ON "trade_events"("trade_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "trade_messages_storage_key_key" ON "trade_messages"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "trade_messages_trade_id_seq_key" ON "trade_messages"("trade_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "trade_messages_trade_id_sender_id_client_message_id_key" ON "trade_messages"("trade_id", "sender_id", "client_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "disputes_trade_id_key" ON "disputes"("trade_id");

-- CreateIndex
CREATE INDEX "disputes_status_createdAt_idx" ON "disputes"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_evidence_storage_key_key" ON "dispute_evidence"("storage_key");

-- CreateIndex
CREATE INDEX "dispute_evidence_dispute_id_idx" ON "dispute_evidence"("dispute_id");

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_payment_methods" ADD CONSTRAINT "offer_payment_methods_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_payment_methods" ADD CONSTRAINT "offer_payment_methods_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_events" ADD CONSTRAINT "trade_events_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_messages" ADD CONSTRAINT "trade_messages_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_chat_reads" ADD CONSTRAINT "trade_chat_reads_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trader_stats" ADD CONSTRAINT "trader_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------- checks
-- An offer's arithmetic, enforced where a bug in the service cannot reach.
ALTER TABLE "offers"
  ADD CONSTRAINT "offers_price_positive" CHECK ("price_santim" > 0),
  ADD CONSTRAINT "offers_total_positive" CHECK ("total_amount" > 0),
  ADD CONSTRAINT "offers_remaining_within_total"
    CHECK ("remaining_amount" >= 0 AND "remaining_amount" <= "total_amount"),
  ADD CONSTRAINT "offers_limits_ordered" CHECK ("min_santim" > 0 AND "min_santim" <= "max_santim"),
  ADD CONSTRAINT "offers_payment_window_positive" CHECK ("payment_window_minutes" > 0);

-- A trade's amount is what its escrow holds; the fee comes out of it, never on top.
ALTER TABLE "trades"
  ADD CONSTRAINT "trades_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "trades_fee_within_amount" CHECK ("fee" >= 0 AND "fee" <= "amount"),
  ADD CONSTRAINT "trades_price_positive" CHECK ("price_santim" > 0),
  ADD CONSTRAINT "trades_fiat_nonnegative" CHECK ("fiat_santim" >= 0),
  ADD CONSTRAINT "trades_chat_seq_nonnegative" CHECK ("chat_seq" >= 0);

-- Messages are numbered from one, in one order per trade.
ALTER TABLE "trade_messages"
  ADD CONSTRAINT "trade_messages_seq_positive" CHECK ("seq" > 0);
