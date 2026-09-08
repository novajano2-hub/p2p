-- Two roles, least privilege. Applied once per database: by docker-compose on
-- first start locally, by a one-off step in CI, by the platform team in
-- production (with real passwords from the secrets manager; these are local).
--
--   abay_migrator  owns the schema. Only migrations connect as this role.
--   abay_app       the running API. Rows in, rows out. It cannot CREATE,
--                  ALTER or DROP anything, so a compromised API process
--                  cannot rewrite the schema, disable a trigger, or drop the
--                  ledger.
--
-- Later migrations tighten abay_app further: the ledger tables will REVOKE
-- UPDATE and DELETE from it outright, so immutability is enforced by the
-- database's permission system as well as by triggers.

CREATE ROLE abay_migrator LOGIN PASSWORD 'migrator';
CREATE ROLE abay_app LOGIN PASSWORD 'app';

GRANT CONNECT ON DATABASE abay TO abay_migrator, abay_app;
GRANT CREATE ON DATABASE abay TO abay_migrator;

\connect abay

ALTER SCHEMA public OWNER TO abay_migrator;
GRANT USAGE ON SCHEMA public TO abay_app;

-- Everything the migrator creates from now on is readable and writable by the
-- app, unless a migration says otherwise.
ALTER DEFAULT PRIVILEGES FOR ROLE abay_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO abay_app;
ALTER DEFAULT PRIVILEGES FOR ROLE abay_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO abay_app;
ALTER DEFAULT PRIVILEGES FOR ROLE abay_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO abay_app;
