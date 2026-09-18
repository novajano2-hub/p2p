-- An ad's version, the terms an order was placed under, and orders that
-- cannot vanish with their ad.
--
-- The version goes up whenever the advertiser changes something a taker reads
-- before committing: the price, the limits, the rails, how long they have to
-- pay, the terms, who may take it. An order carries the version its taker was
-- looking at and is refused if the two differ, so nobody is ever given an
-- order on terms they never saw. Taking from an ad does not move it, and
-- neither does going offline and back.
ALTER TABLE "offers" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

-- What the taker agreed to, kept with the order rather than read from the ad
-- its owner may edit afterwards. Null for orders opened before this column and
-- for ads that carry no terms.
ALTER TABLE "trades" ADD COLUMN "offer_terms" TEXT;

-- The link to the ad was ON DELETE CASCADE: deleting one ad row would have
-- taken its orders with it - and their chat, evidence and disputes - while the
-- ledger went on recording the money those orders moved. The application
-- closes ads and never deletes them; now nothing can.
ALTER TABLE "trades" DROP CONSTRAINT "trades_offer_id_fkey";
ALTER TABLE "trades" ADD CONSTRAINT "trades_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
