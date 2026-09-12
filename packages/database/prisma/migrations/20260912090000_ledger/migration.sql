-- The ledger: the platform's record of who owns what.
--
-- Implements docs/architecture/ledger-taxonomy.md. The tables below are
-- generated from schema.prisma; everything after them is hand-written and is
-- the part that matters, because it is what stops application code from being
-- the only thing keeping the books straight.
--
-- The four appended sections are kept as files under packages/database/sql/ so
-- they can be read on their own and re-applied deliberately:
--   ledger-invariants.sql          transactions balance, amounts are sane, the floor
--   ledger-balance-projection.sql  balances follow entries, automatically
--   ledger-immutability.sql        posted history cannot be edited, by anyone
--   ledger-chart-of-accounts.sql   the eleven platform accounts
--
-- No money can move yet: this migration creates the books and the rules, and
-- LedgerService (stage 2) is the only thing that will be allowed to write to
-- them.

-- CreateEnum
CREATE TYPE "ledger_account_type" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ledger_asset" AS ENUM ('USDT');

-- CreateEnum
CREATE TYPE "ledger_direction" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "ledger_account_scope" AS ENUM ('USER', 'TRADE', 'PLATFORM');

-- CreateEnum
CREATE TYPE "ledger_actor_type" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ledger_reason" AS ENUM ('OPENING_BALANCE', 'DEPOSIT_CREDITED', 'SWEEP_BROADCAST', 'SWEEP_CONFIRMED', 'UNIDENTIFIED_DEPOSIT_RECEIVED', 'UNIDENTIFIED_DEPOSIT_ATTRIBUTED', 'WITHDRAWAL_HELD', 'WITHDRAWAL_HOLD_RELEASED', 'WITHDRAWAL_BROADCAST', 'WITHDRAWAL_CONFIRMED', 'ESCROW_LOCKED', 'ESCROW_RELEASED', 'ESCROW_REFUNDED_EXPIRY', 'ESCROW_REFUNDED_CANCELLED', 'DISPUTE_RESOLVED_RELEASE', 'DISPUTE_RESOLVED_REFUND', 'RECONCILIATION_SURPLUS_RECORDED', 'RECONCILIATION_SHORTFALL_WRITTEN_OFF');

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ledger_account_type" NOT NULL,
    "scope" "ledger_account_scope" NOT NULL,
    "asset" "ledger_asset" NOT NULL,
    "owner_id" TEXT,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" TEXT NOT NULL,
    "asset" "ledger_asset" NOT NULL,
    "reason" "ledger_reason" NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "actor_type" "ledger_actor_type" NOT NULL,
    "actor_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "reverses_transaction_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "direction" "ledger_direction" NOT NULL,
    "amount" BIGINT NOT NULL,
    "signed_amount" BIGINT NOT NULL,
    "asset" "ledger_asset" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_account_balances" (
    "account_id" TEXT NOT NULL,
    "asset" "ledger_asset" NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "allows_negative" BOOLEAN NOT NULL,
    "entry_count" INTEGER NOT NULL DEFAULT 0,
    "last_transaction_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_account_balances_pkey" PRIMARY KEY ("account_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");

-- CreateIndex
CREATE INDEX "ledger_accounts_scope_owner_id_idx" ON "ledger_accounts"("scope", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_idempotency_key_key" ON "ledger_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_transactions_reference_type_reference_id_idx" ON "ledger_transactions"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_reason_createdAt_idx" ON "ledger_transactions"("reason", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_transactions_createdAt_idx" ON "ledger_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_createdAt_idx" ON "ledger_entries"("account_id", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reverses_transaction_id_fkey" FOREIGN KEY ("reverses_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_account_balances" ADD CONSTRAINT "ledger_account_balances_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- ==========================================================================
-- invariants: balance, amounts, the floor
-- from packages/database/sql/ledger-invariants.sql
-- ==========================================================================

-- The ledger's invariants, enforced by PostgreSQL.
--
-- docs/architecture/ledger-taxonomy.md section 6 lists these as L1-L10. The
-- ones below are the ones a database can hold on its own, and they are here
-- rather than in the LedgerService for one reason: application code is where
-- the bug will be. A service method is the right place to express intent and
-- the wrong place to keep a guarantee, because the guarantee then lasts
-- exactly as long as nobody writes a second way in - a migration, a repair
-- script, a future module in a hurry. Everything below refuses all of them.
--
-- What is NOT here: the "take SELECT ... FOR UPDATE in ascending account id
-- order" discipline, which no constraint can express. That is the service's
-- job and stage 2's subject.

-- ---------------------------------------------------------------- L: amounts

-- An amount is a magnitude; DEBIT/CREDIT carries the sense. Zero is allowed
-- on purpose: the fee leg is posted at zero while fees are off, so that
-- turning them on never changes the shape of a transaction (taxonomy JE-4).
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_amount_non_negative" CHECK ("amount" >= 0);

-- signed_amount is the whole balance check, so it must be impossible for it
-- to disagree with the direction and amount it summarises.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_signed_amount_matches_direction" CHECK (
    "signed_amount" = CASE WHEN "direction" = 'DEBIT' THEN "amount" ELSE -"amount" END
  );

-- ------------------------------------------------------------ L5: the floor

-- Customers and trades cannot go overdrawn, and it is the database that says
-- so rather than an `if` in a service (ADR-0009). allows_negative is true only
-- where a negative position is meaningful: equity, revenue, expense.
ALTER TABLE "ledger_account_balances"
  ADD CONSTRAINT "ledger_account_balances_floor" CHECK (
    "balance" >= 0 OR "allows_negative"
  );

-- ------------------------------------------ L1, L2, L3: transactions balance

-- Deferred to COMMIT, which is the only time the question can be answered: a
-- transaction is balanced as a whole, and its first entry is necessarily
-- unbalanced on its own.
--
-- Checks all three of the taxonomy's structural invariants at once, because
-- they are one idea - a transaction is a complete, single-asset, balanced
-- journal entry - and splitting them across three triggers would only mean
-- three chances to drop one.
CREATE OR REPLACE FUNCTION ledger_transaction_is_balanced() RETURNS trigger AS $$
DECLARE
  entry_count integer;
  asset_count integer;
  net         bigint;
BEGIN
  SELECT count(*), count(DISTINCT asset), COALESCE(sum(signed_amount), 0)
    INTO entry_count, asset_count, net
    FROM ledger_entries
   WHERE transaction_id = NEW.transaction_id;

  -- A transaction whose entries were all removed cannot happen (they are
  -- immutable), but a transaction row with no entries at all can be inserted,
  -- and that is not a journal entry either.
  IF entry_count < 2 THEN
    RAISE EXCEPTION 'ledger transaction % has % entr(y|ies): a journal entry needs at least two',
      NEW.transaction_id, entry_count
      USING ERRCODE = 'check_violation';
  END IF;

  IF asset_count <> 1 THEN
    RAISE EXCEPTION 'ledger transaction % mixes % assets: one asset per transaction until a clearing model exists',
      NEW.transaction_id, asset_count
      USING ERRCODE = 'check_violation';
  END IF;

  IF net <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % does not balance: debits minus credits = %',
      NEW.transaction_id, net
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_balance_check ON ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entries_balance_check
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_transaction_is_balanced();


-- ==========================================================================
-- the balance projection
-- from packages/database/sql/ledger-balance-projection.sql
-- ==========================================================================

-- The balance projection follows the entries, automatically.
--
-- ADR-0009 says the balance table is updated "in the same transaction as the
-- entries that change it". This is the strongest reading of that: a trigger,
-- so it is not merely in the same transaction but in the same statement, and
-- posting an entry without moving the balance is not something a caller can
-- get wrong because it is not something a caller does at all.
--
-- The alternative - the service writes entries and then updates balances - was
-- rejected for a specific reason rather than on taste. It gives every future
-- posting path its own chance to compute a sign backwards, and a sign error in
-- a liability account is the kind of bug that looks like money appearing.
-- Here the arithmetic exists once.
--
-- NOTE the sign convention, which is the subtle part. `balance` is kept in the
-- account's NATURAL sense, so a customer with 100 USDT available reads
-- +100,000,000 even though the entries that put it there were credits. That is
-- what makes `CHECK (balance >= 0)` mean what a person expects. Debits raise
-- an asset or an expense; credits raise a liability, equity or revenue.

CREATE OR REPLACE FUNCTION ledger_apply_entry_to_balance() RETURNS trigger AS $$
DECLARE
  account_type ledger_account_type;
  delta        bigint;
BEGIN
  SELECT type INTO account_type FROM ledger_accounts WHERE id = NEW.account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ledger entry % references unknown account %', NEW.id, NEW.account_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  delta := CASE
    WHEN account_type IN ('ASSET', 'EXPENSE')
      THEN NEW.signed_amount          -- debit positive
    ELSE -NEW.signed_amount           -- credit positive
  END;

  UPDATE ledger_account_balances
     SET balance             = balance + delta,
         entry_count         = entry_count + 1,
         last_transaction_id = NEW.transaction_id,
         version             = version + 1,
         "updatedAt"         = now()
   WHERE account_id = NEW.account_id;

  -- The balance row is created with the account, so its absence is a broken
  -- invariant rather than a case to handle by inserting one: an account whose
  -- balance row appeared late would be an account that could be spent from
  -- before anything could lock it.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ledger account % has no balance row; accounts must be created with one', NEW.account_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_apply_to_balance ON ledger_entries;
CREATE TRIGGER ledger_entries_apply_to_balance
  AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_apply_entry_to_balance();


-- ==========================================================================
-- immutability of posted history
-- from packages/database/sql/ledger-immutability.sql
-- ==========================================================================

-- Posted ledger history cannot be changed. By anyone.
--
-- This is invariant L4, and the reason it is worth more than a code review
-- promise: the whole platform's claim is "ownership of this money exists in
-- our ledger". A ledger whose rows can be edited by the process serving HTTP
-- requests supports a much weaker claim - that ownership exists in our ledger
-- unless something went wrong, in which case we cannot tell.
--
-- Two independent mechanisms, on purpose. The GRANT system stops the
-- application role, which is what an attacker who compromises the API gets.
-- The triggers stop everyone the GRANT system does not - the table owner, a
-- migration, a psql session opened at 2am to "just fix one row".
--
-- Corrections are new transactions carrying reverses_transaction_id. The
-- history then shows that money moved and came back, which is what a support
-- agent needs to see and what an edit would destroy.
--
-- Removing any of this is a deliberate act with its own migration.

-- ------------------------------------------------------------- the triggers

CREATE OR REPLACE FUNCTION ledger_rows_are_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger history is immutable: % on % is not permitted. Post a reversing transaction instead',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_no_update ON ledger_entries;
CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_rows_are_immutable();

DROP TRIGGER IF EXISTS ledger_entries_no_delete ON ledger_entries;
CREATE TRIGGER ledger_entries_no_delete
  BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_rows_are_immutable();

-- TRUNCATE is neither an UPDATE nor a DELETE and a row-level trigger never
-- sees it.
DROP TRIGGER IF EXISTS ledger_entries_no_truncate ON ledger_entries;
CREATE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_rows_are_immutable();

DROP TRIGGER IF EXISTS ledger_transactions_no_update ON ledger_transactions;
CREATE TRIGGER ledger_transactions_no_update
  BEFORE UPDATE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_rows_are_immutable();

DROP TRIGGER IF EXISTS ledger_transactions_no_delete ON ledger_transactions;
CREATE TRIGGER ledger_transactions_no_delete
  BEFORE DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_rows_are_immutable();

DROP TRIGGER IF EXISTS ledger_transactions_no_truncate ON ledger_transactions;
CREATE TRIGGER ledger_transactions_no_truncate
  BEFORE TRUNCATE ON ledger_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_rows_are_immutable();

-- ----------------------------------------------------------- the privileges

-- roles.sql granted the app role INSERT, UPDATE, DELETE on everything the
-- migrator creates, and said these tables would take two of those back. This
-- is that.
REVOKE UPDATE, DELETE, TRUNCATE ON "ledger_entries" FROM abay_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "ledger_transactions" FROM abay_app;

-- ledger_account_balances deliberately keeps UPDATE, and it is worth being
-- explicit about why, because at a glance it looks like the gap in the fence.
--
-- It is a projection, not history. It has to be writable because the balance
-- row is the lock: moving money means SELECT ... FOR UPDATE on it first, and
-- PostgreSQL requires the UPDATE privilege to take that lock - so revoking
-- UPDATE here would not harden the ledger, it would disable the concurrency
-- control that keeps two trades from spending the same coins.
--
-- What makes that safe is that this table is derived. Every row in it can be
-- recomputed from ledger_entries, which cannot be touched; a tampered or
-- corrupted balance is a recoverable inconsistency rather than a lost fact,
-- and the rebuild-and-compare test (AT-11) is what notices. The immutable
-- thing is the history; the balance is a cache of it with a lock attached.


-- ==========================================================================
-- the platform chart of accounts
-- from packages/database/sql/ledger-chart-of-accounts.sql
-- ==========================================================================

-- The platform's chart of accounts (taxonomy 3.3 - 3.6).
--
-- These eleven accounts are fixed: they are the platform's own, they exist
-- before any customer does, and they are the same in every environment. User
-- and trade accounts are not here because they are created on first use.
--
-- The ids are written down rather than generated so that a platform account
-- has the same id in development, in CI and in production. A fixture or a
-- support query can then name one without a lookup, and two environments can
-- be compared row for row.
--
-- Idempotent, so re-running it is harmless: this file is applied by a
-- migration, and a chart of accounts is a thing you add to rather than
-- replace.

INSERT INTO "ledger_accounts" (id, code, type, scope, asset, owner_id, purpose, "createdAt")
SELECT v.id, v.code, v.type::ledger_account_type, 'PLATFORM'::ledger_account_scope,
       'USDT'::ledger_asset, NULL, v.purpose, now()
FROM (VALUES
  ('01a093c7-3cb6-762d-8a0b-b94f24754e03', 'ASSET:PLATFORM:USDT:DEPOSIT_ADDRESSES', 'ASSET', 'DEPOSIT_ADDRESSES', false),
  ('01a093c7-3cbb-72f8-97f5-e666648d44ae', 'ASSET:PLATFORM:USDT:TREASURY_HOT', 'ASSET', 'TREASURY_HOT', false),
  ('01a093c7-3cbb-72f8-97f5-e99f29c953fd', 'ASSET:PLATFORM:USDT:TREASURY_COLD', 'ASSET', 'TREASURY_COLD', false),
  ('01a093c7-3cbc-7695-8958-e3d0bf804f20', 'ASSET:PLATFORM:USDT:IN_TRANSIT', 'ASSET', 'IN_TRANSIT', false),
  ('01a093c7-3cbc-7695-8958-e421b1133995', 'LIAB:PLATFORM:USDT:UNIDENTIFIED_DEPOSITS', 'LIABILITY', 'UNIDENTIFIED_DEPOSITS', false),
  ('01a093c7-3cbc-7695-8958-e9d6e0ba347e', 'LIAB:PLATFORM:USDT:RECONCILIATION_SUSPENSE', 'LIABILITY', 'RECONCILIATION_SUSPENSE', false),
  ('01a093c7-3cbd-754c-9c39-3fe3ab9fd90b', 'REV:PLATFORM:USDT:TRADE_FEES', 'REVENUE', 'TRADE_FEES', true),
  ('01a093c7-3cbd-754c-9c39-41cb2e4ff156', 'REV:PLATFORM:USDT:WITHDRAWAL_FEES', 'REVENUE', 'WITHDRAWAL_FEES', true),
  ('01a093c7-3cbd-754c-9c39-457961422bab', 'EXP:PLATFORM:USDT:NETWORK_FEES', 'EXPENSE', 'NETWORK_FEES', true),
  ('01a093c7-3cbd-754c-9c39-4a78b417ced3', 'EXP:PLATFORM:USDT:LOSSES', 'EXPENSE', 'LOSSES', true),
  ('01a093c7-3cbe-7189-90a6-9d5a752ce89e', 'EQUITY:PLATFORM:USDT:OPENING_BALANCE', 'EQUITY', 'OPENING_BALANCE', true)
) AS v(id, code, type, purpose, allows_negative)
ON CONFLICT (code) DO NOTHING;

-- Every account gets its balance row at creation, at zero. Never lazily: an
-- account whose balance row appeared on first use would be an account that
-- could be posted to before anything could lock it, and the lock is the whole
-- concurrency control (ADR-0009).
--
-- allows_negative is derived from the type. A customer or a trade cannot be
-- overdrawn and neither can a pile of coins we either control or do not;
-- equity, revenue and expense positions can legitimately sit either side of
-- zero (a refund, a recovery), so they are the exceptions.
INSERT INTO "ledger_account_balances" (account_id, asset, balance, allows_negative, entry_count, last_transaction_id, version, "updatedAt")
SELECT a.id, a.asset, 0, a.type IN ('EQUITY', 'REVENUE', 'EXPENSE'), 0, NULL, 0, now()
FROM "ledger_accounts" a
WHERE a.scope = 'PLATFORM'
ON CONFLICT (account_id) DO NOTHING;
