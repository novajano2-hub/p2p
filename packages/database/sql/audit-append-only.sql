-- audit_events is append-only, enforced by the database.
--
-- The threat this answers is B7.4: an administrator denies having acted. A log
-- that the acting administrator can edit or delete answers nothing, and a
-- convention ("we never update this table") is not a control - it is a hope
-- about every future line of code, including the ones written in a hurry.
--
-- So the rule lives where it cannot be forgotten. INSERT is allowed. UPDATE and
-- DELETE raise, whoever attempts them, including the application role and
-- including a migration that did not mean to.
--
-- TRUNCATE is covered separately: it is not a DELETE and a row-level trigger
-- never sees it.
--
-- Removing this is a deliberate act with its own migration, which is the point.

CREATE OR REPLACE FUNCTION audit_events_are_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_are_append_only();

DROP TRIGGER IF EXISTS audit_events_no_delete ON audit_events;
CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_are_append_only();

DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_are_append_only();
