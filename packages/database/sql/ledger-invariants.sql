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
