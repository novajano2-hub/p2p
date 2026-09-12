-- Which question an administrator's approval answered.
--
-- SEND authorises the transfer. FAILED_CONFIRMED attests that nothing ever
-- reached the chain, which is the one resolution that gives money back and so
-- needs two people (ADR-0010, AT-9). The unique key gains the decision so that
-- one administrator can answer each question once, and the two are never
-- mistaken for each other.
-- CreateEnum
CREATE TYPE "withdrawal_decision" AS ENUM ('SEND', 'FAILED_CONFIRMED');

-- DropIndex
DROP INDEX "withdrawal_approvals_withdrawal_id_admin_id_key";

-- AlterTable
ALTER TABLE "withdrawal_approvals" ADD COLUMN     "decision" "withdrawal_decision" NOT NULL DEFAULT 'SEND';

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_approvals_withdrawal_id_admin_id_decision_key" ON "withdrawal_approvals"("withdrawal_id", "admin_id", "decision");

