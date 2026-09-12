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
