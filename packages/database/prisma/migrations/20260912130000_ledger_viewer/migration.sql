-- A role for reading the ledger, separate from any role that acts on it.
--
-- Balances and posted history are CONFIDENTIAL where they concern a specific
-- person (docs/architecture/data-classification.md), so seeing them is a
-- capability granted on its own, per person, like every other admin
-- capability (threat model B7.1) - not something that comes with being able
-- to resolve a dispute or approve a withdrawal, and not something an auditor
-- has to be given the power to move money in order to receive.
ALTER TYPE "admin_role" ADD VALUE 'LEDGER_VIEWER';

-- The viewer looks transactions up by the request that caused them.
CREATE INDEX "ledger_transactions_correlation_id_idx" ON "ledger_transactions"("correlation_id");
