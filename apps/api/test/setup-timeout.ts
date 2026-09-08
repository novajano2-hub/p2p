/*
  Jest ignores `testTimeout` when it is set inside a `projects` entry, so it has
  to be set here, after the test framework is installed.

  The API tests need the headroom: each registration does a real Argon2id hash
  (deliberately expensive) and the helper that recovers a verification code
  scans the six-digit space against a SHA-256 hash, because the database stores
  only the hash and there is no mail provider to read the code from.
*/
jest.setTimeout(30_000);
