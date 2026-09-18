-- A sell ad its seller's balance cannot cover.
--
-- Posting an ad locks nothing (ADR-0004), so a seller may advertise more than
-- they hold, and the market shows a sell ad only while their available
-- balance covers its smallest order. These two columns are the worker's
-- memory of that (OfferService.checkFunding): when the balance stopped
-- covering the ad, so it can go offline by itself after a day, and when its
-- owner was last told, so a balance hovering at the edge does not tell them
-- again every time it dips.
ALTER TABLE "offers" ADD COLUMN "unfunded_since" TIMESTAMP(3),
ADD COLUMN "unfunded_notified_at" TIMESTAMP(3);

-- What the seller is told: the ad is hidden, and later that it went offline.
ALTER TYPE "notification_type" ADD VALUE 'OFFER_HIDDEN';
ALTER TYPE "notification_type" ADD VALUE 'OFFER_PAUSED';
