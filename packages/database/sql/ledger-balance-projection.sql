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
