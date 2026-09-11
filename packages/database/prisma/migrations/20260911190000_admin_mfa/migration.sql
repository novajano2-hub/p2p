-- The second factor for administrator accounts (threat model B7.3).
--
-- totp_secret and totp_pending_secret hold the base32 TOTP secret encrypted
-- with FIELD_ENCRYPTION_KEY (AES-256-GCM, apps/api field-encryption), never
-- plaintext: reading this table must not be enough to mint valid codes.
-- totp_enrolled_at NULL means not enrolled, and the API confines such a
-- session to the enrollment routes. totp_last_used_step records the last
-- accepted 30-second step so no code is ever accepted twice.
ALTER TABLE "admin_users"
  ADD COLUMN "totp_secret" TEXT,
  ADD COLUMN "totp_pending_secret" TEXT,
  ADD COLUMN "totp_enrolled_at" TIMESTAMP(3),
  ADD COLUMN "totp_last_used_step" BIGINT;
