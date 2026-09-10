-- The customer-facing account number and username (see schema.prisma).
--
-- Written by hand rather than as Prisma generated it: the columns are NOT
-- NULL, and a database that already has accounts cannot take a NOT NULL
-- column with no default. So they are added nullable, every existing row is
-- given the same generated values a new account would get, and only then are
-- the constraints applied. On an empty database the UPDATEs touch nothing.

ALTER TABLE "users"
  ADD COLUMN "platform_id" TEXT,
  ADD COLUMN "username" TEXT,
  ADD COLUMN "username_key" TEXT;

-- BQ- and eight random digits, never a leading zero. A collision between two
-- existing rows would fail the unique index below, which is the right outcome:
-- the migration is re-run and draws again.
UPDATE "users"
SET "platform_id" = 'BQ-' || (10000000 + floor(random() * 90000000))::bigint::text
WHERE "platform_id" IS NULL;

UPDATE "users"
SET "username" = 'user_' || substring("platform_id" from 4),
    "username_key" = 'user_' || substring("platform_id" from 4)
WHERE "username" IS NULL;

ALTER TABLE "users"
  ALTER COLUMN "platform_id" SET NOT NULL,
  ALTER COLUMN "username" SET NOT NULL,
  ALTER COLUMN "username_key" SET NOT NULL;

CREATE UNIQUE INDEX "users_platform_id_key" ON "users"("platform_id");
CREATE UNIQUE INDEX "users_username_key_key" ON "users"("username_key");
