/*
  One live account for each kind (Phase 5, stage 5, the owner's review).

  An order names a kind - "Telebirr" - and its buyer is shown the one account
  behind it. A second live account of the same kind could never be the one a
  buyer saw, and a seller watching it would be watching the wrong account. So
  there is one, and a changed number is a replacement
  (PaymentMethodService.replace), not a second method.

  Rows that already break the rule are put right first: of several live
  accounts of one kind the newest stays; the others are archived, and a live
  ad that named one of them names the one that stays. A trade keeps the
  details it was opened with, as always - those are its own snapshot.
*/

-- Live ads that named an account about to be archived name the one that stays.
WITH ranked AS (
  SELECT id,
         first_value(id) OVER w AS keep_id,
         row_number() OVER w AS n
  FROM "payment_methods"
  WHERE "status" = 'ACTIVE'
  WINDOW w AS (PARTITION BY "user_id", "kind" ORDER BY "createdAt" DESC, id DESC)
)
UPDATE "offer_payment_methods" AS rail
SET "payment_method_id" = ranked.keep_id
FROM ranked, "offers"
WHERE rail."payment_method_id" = ranked.id
  AND ranked.n > 1
  AND "offers".id = rail."offer_id"
  AND "offers"."status" IN ('ACTIVE', 'PAUSED');

-- An ad that named two of them now names the same one twice. Once is enough.
DELETE FROM "offer_payment_methods" AS later
USING "offer_payment_methods" AS earlier
WHERE later."offer_id" = earlier."offer_id"
  AND later."payment_method_id" = earlier."payment_method_id"
  AND later.id > earlier.id;

-- The others are archived, not deleted: a trade that snapshotted one still points at it.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY "user_id", "kind" ORDER BY "createdAt" DESC, id DESC
         ) AS n
  FROM "payment_methods"
  WHERE "status" = 'ACTIVE'
)
UPDATE "payment_methods" AS method
SET "status" = 'ARCHIVED', "archived_at" = now(), "updatedAt" = now()
FROM ranked
WHERE method.id = ranked.id
  AND ranked.n > 1;

-- The rule itself. Partial, so archived methods - history - are outside it;
-- Prisma's schema cannot express that, so it is written here by hand.
CREATE UNIQUE INDEX "payment_methods_one_live_per_kind"
  ON "payment_methods"("user_id", "kind")
  WHERE "status" = 'ACTIVE';
