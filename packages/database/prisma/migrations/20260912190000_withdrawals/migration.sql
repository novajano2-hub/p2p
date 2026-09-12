-- Phase 3, stage 3: what a withdrawal tells the customer.
--
-- WITHDRAWAL_SENT when it is confirmed on the chain, WITHDRAWAL_RETURNED when
-- it did not go ahead and the hold went back to available (JE-9). The
-- withdrawal tables themselves arrived with the Phase 3 foundations.
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notification_type" ADD VALUE 'WITHDRAWAL_SENT';
ALTER TYPE "notification_type" ADD VALUE 'WITHDRAWAL_RETURNED';

