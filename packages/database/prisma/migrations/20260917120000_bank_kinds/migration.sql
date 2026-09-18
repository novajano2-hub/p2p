-- The banks people pay through become payment methods of their own, the way
-- Binance lists "BCA" and "Bank BRI" rather than one "bank transfer" with a
-- code beside it. A buyer choosing where to pay wants the bank by name: a
-- transfer within one bank arrives at once, one between banks does not.
-- Four banks at launch; a fifth is a value here and a row in the contracts.
--
-- Postgres cannot use a value added to an enum inside the transaction that
-- added it, so the type is rebuilt and swapped, the way Prisma does it.
CREATE TYPE "payment_method_kind_new" AS ENUM ('TELEBIRR', 'CBE_BIRR', 'MPESA', 'CBE', 'DASHEN', 'ABYSSINIA', 'AWASH');

-- A stored bank method already says which bank, in bank_code. One outside
-- the four launch banks has no value to become and stops this migration
-- here, on purpose: which bank that person now banks with is a decision for
-- a person, never a default.
ALTER TABLE "payment_methods" ALTER COLUMN "kind" TYPE "payment_method_kind_new"
  USING (
    CASE
      WHEN "kind"::text = 'BANK_TRANSFER' THEN (
        CASE "bank_code"
          WHEN 'CBE' THEN 'CBE'
          WHEN 'DASHEN' THEN 'DASHEN'
          WHEN 'ABYSSINIA' THEN 'ABYSSINIA'
          WHEN 'AWASH' THEN 'AWASH'
        END
      )
      ELSE "kind"::text
    END
  )::"payment_method_kind_new";

-- A trade snapshotted one of the seller's methods; its kind follows that
-- method's. A transform expression cannot look at another table, hence the
-- scratch column.
ALTER TABLE "trades" ADD COLUMN "payment_kind_next" TEXT;
UPDATE "trades" AS t
   SET "payment_kind_next" = pm."kind"::text
  FROM "payment_methods" AS pm
 WHERE pm."id" = t."payment_method_id" AND t."payment_kind"::text = 'BANK_TRANSFER';
UPDATE "trades"
   SET "payment_kind_next" = "payment_kind"::text
 WHERE "payment_kind"::text <> 'BANK_TRANSFER';
ALTER TABLE "trades" ALTER COLUMN "payment_kind" TYPE "payment_method_kind_new"
  USING ("payment_kind_next"::"payment_method_kind_new");
ALTER TABLE "trades" DROP COLUMN "payment_kind_next";

-- An offer's rails. On a SELL ad each names one of the seller's methods and
-- follows it. On a BUY ad "bank transfer" named no bank - the buyer meant any
-- bank - so it becomes each of the four, unless the ad names that bank already.
ALTER TABLE "offer_payment_methods" ADD COLUMN "kind_next" TEXT;
UPDATE "offer_payment_methods" AS r
   SET "kind_next" = pm."kind"::text
  FROM "payment_methods" AS pm
 WHERE pm."id" = r."payment_method_id" AND r."kind"::text = 'BANK_TRANSFER';
UPDATE "offer_payment_methods"
   SET "kind_next" = "kind"::text
 WHERE "kind"::text <> 'BANK_TRANSFER';
-- The new rows are told apart from the one they replace by having their
-- kind_next set already; the old column's value on them is a placeholder
-- the cast below overwrites.
INSERT INTO "offer_payment_methods" ("id", "offer_id", "kind", "payment_method_id", "kind_next")
SELECT gen_random_uuid()::text, r."offer_id", 'TELEBIRR', NULL, b."kind"
  FROM "offer_payment_methods" AS r
 CROSS JOIN (VALUES ('CBE'), ('DASHEN'), ('ABYSSINIA'), ('AWASH')) AS b("kind")
 WHERE r."kind"::text = 'BANK_TRANSFER' AND r."payment_method_id" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM "offer_payment_methods" AS x
      WHERE x."offer_id" = r."offer_id" AND x."kind_next" = b."kind"
   );
DELETE FROM "offer_payment_methods"
 WHERE "kind"::text = 'BANK_TRANSFER' AND "payment_method_id" IS NULL AND "kind_next" IS NULL;
ALTER TABLE "offer_payment_methods" ALTER COLUMN "kind" TYPE "payment_method_kind_new"
  USING ("kind_next"::"payment_method_kind_new");
ALTER TABLE "offer_payment_methods" DROP COLUMN "kind_next";

DROP TYPE "payment_method_kind";
ALTER TYPE "payment_method_kind_new" RENAME TO "payment_method_kind";

-- The bank is the kind now.
ALTER TABLE "payment_methods" DROP COLUMN "bank_code";
