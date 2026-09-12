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
