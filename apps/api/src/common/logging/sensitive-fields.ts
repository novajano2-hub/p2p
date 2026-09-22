/*
  Every field this API handles that must never reach a log, named once.

  docs/architecture/data-classification.md is the policy: what is
  CONFIDENTIAL, RESTRICTED or SECRET, and why. This file is that policy as
  code, and two things are built from it rather than written beside it:

    - logging.module.ts turns every entry marked `redact` into a pino
      redaction path, so the key is censored wherever it appears in a logged
      object, at any depth a log line realistically has;

    - test/api/redaction.spec.ts (AT-13) plants or captures a sentinel value
      for every entry, drives the flows that carry it - sign-up, sign-in,
      payment methods, a trade with its chat and its dispute, a withdrawal,
      identity verification, the admin realm, the custody webhook, and the
      deliberate failures along the way - then reads the whole log stream
      back looking for the sentinels. Its sentinel table is typed from this
      list, so an entry added here without a sentinel there does not compile.

  Some entries are deliberately not censored by name. `code` is also every
  error's code and every ledger account's; `reason` is the ledger's posting
  reason; `q` is a query parameter. Blanking those names would blind the
  logs an incident is investigated with. They are safe for a different
  reason, and the sentinel test proves it rather than assumes it: request
  bodies, query strings and headers are never serialised at all (the request
  serializer in logging.module.ts keeps the id, the method, the path and the
  caller's address, nothing else), so a field that only ever travels in one
  of those never reaches a line to be redacted from.

  Absent, also deliberately: names that nothing carries. An earlier list
  censored `refreshToken`, `otp` and `paymentInstructions`, none of which
  exists here, and a censor for a field that does not exist is a promise no
  test can keep. RESEND_API_KEY and the STORAGE_* credentials are SECRET as
  well, but the suite cannot plant them without sending real mail and
  writing a real bucket; they are covered by the secret inventory in the
  document, and config/env.spec.ts shows the environment loader never echoes
  a value.
*/

export type Classification = "CONFIDENTIAL" | "RESTRICTED" | "SECRET";

/** How the field travels: a request body or query, a database row, a response, a header, or the environment. */
export type Carrier = "request" | "row" | "response" | "header" | "env";

export interface SensitiveField {
  /** The key exactly as it is carried. */
  readonly key: string;
  readonly classification: Classification;
  readonly where: Carrier;
  /** Which flows carry it - what the sentinel test has to drive. */
  readonly carriedBy: string;
  /** Censored by name wherever it appears in a logged object. */
  readonly redact: boolean;
}

export const SENSITIVE_FIELDS = [
  /* -------------------------------------- credentials, and the tokens between steps */
  {
    key: "password",
    classification: "RESTRICTED",
    where: "request",
    carriedBy:
      "sign-up, sign-in, password reset, admin sign-in, releasing a trade, requesting a withdrawal",
    redact: true,
  },
  {
    key: "passwordHash",
    classification: "RESTRICTED",
    where: "row",
    carriedBy: "auth_identities and admin_users",
    redact: true,
  },
  {
    key: "code",
    classification: "CONFIDENTIAL",
    where: "request",
    carriedBy: "the six digits: an emailed verification code, an authenticator code",
    redact: false,
  },
  {
    key: "ticket",
    classification: "CONFIDENTIAL",
    where: "request",
    carriedBy: "the token between two steps of sign-up, sign-in and password reset",
    redact: true,
  },
  {
    key: "cookie",
    classification: "CONFIDENTIAL",
    where: "header",
    carriedBy: "the session token, on every signed-in request",
    redact: false,
  },
  {
    key: "set-cookie",
    classification: "CONFIDENTIAL",
    where: "header",
    carriedBy: "the session token, as a session starts",
    redact: false,
  },
  {
    key: "x-csrf-token",
    classification: "CONFIDENTIAL",
    where: "header",
    carriedBy: "every cookie-authenticated mutation, and every authenticated response",
    redact: false,
  },
  {
    key: "secret",
    classification: "SECRET",
    where: "response",
    carriedBy: "an administrator's authenticator secret, handed over once at MFA setup",
    redact: true,
  },
  {
    key: "otpauthUri",
    classification: "SECRET",
    where: "response",
    carriedBy: "the same secret, inside the URI the QR code encodes",
    redact: true,
  },
  {
    key: "totpSecret",
    classification: "SECRET",
    where: "row",
    carriedBy: "admin_users, encrypted",
    redact: true,
  },
  {
    key: "totpPendingSecret",
    classification: "SECRET",
    where: "row",
    carriedBy: "admin_users, encrypted, between setup and confirmation",
    redact: true,
  },

  /* ------------------------------------------------------------- who a person is */
  {
    key: "email",
    classification: "CONFIDENTIAL",
    where: "request",
    carriedBy: "sign-up, sign-in and password reset; users and admin_users",
    redact: true,
  },
  {
    key: "q",
    classification: "CONFIDENTIAL",
    where: "request",
    carriedBy: "the administrator's customer search: an email, a username or an account number",
    redact: false,
  },
  {
    key: "legalName",
    classification: "RESTRICTED",
    where: "request",
    carriedBy: "identity verification; kyc_submissions",
    redact: true,
  },
  {
    key: "dateOfBirth",
    classification: "RESTRICTED",
    where: "request",
    carriedBy: "identity verification; kyc_submissions",
    redact: true,
  },
  {
    key: "documentNumber",
    classification: "RESTRICTED",
    where: "request",
    carriedBy: "identity verification; kyc_submissions",
    redact: true,
  },

  /* ---------------------------------------------------------- where a person is paid */
  {
    key: "accountHolder",
    classification: "RESTRICTED",
    where: "request",
    carriedBy: "payment methods; snapshotted onto every trade that uses one",
    redact: true,
  },
  {
    key: "accountNumber",
    classification: "RESTRICTED",
    where: "request",
    carriedBy: "bank payment methods",
    redact: true,
  },
  {
    key: "phone",
    classification: "RESTRICTED",
    where: "request",
    carriedBy: "mobile-money payment methods",
    redact: true,
  },
  {
    key: "instructions",
    classification: "RESTRICTED",
    where: "response",
    carriedBy:
      "a payment method read back by its owner; the copy on a trade its buyer reads; a dispute's detail",
    redact: true,
  },
  {
    key: "reference",
    classification: "CONFIDENTIAL",
    where: "request",
    carriedBy: 'the transfer reference on "I have paid"',
    redact: false,
  },

  /* -------------------------------------- what people wrote to, and about, each other */
  {
    key: "body",
    classification: "CONFIDENTIAL",
    where: "request",
    carriedBy: "a chat message; a notification's text",
    redact: true,
  },
  {
    key: "description",
    classification: "RESTRICTED",
    where: "request",
    carriedBy: "a dispute's statement",
    redact: true,
  },
  {
    key: "note",
    classification: "RESTRICTED",
    where: "request",
    carriedBy: "a caption on dispute evidence; a resolver's note on the decision",
    redact: true,
  },
  {
    key: "reason",
    classification: "CONFIDENTIAL",
    where: "request",
    carriedBy: "free text with a cancellation or an administrator's decision",
    redact: false,
  },

  /* ------------------------------------------------------- what a machine signs with */
  {
    key: "x-custody-signature",
    classification: "CONFIDENTIAL",
    where: "header",
    carriedBy: "the custody provider's signature over a webhook",
    redact: false,
  },
  {
    key: "CUSTODY_WEBHOOK_SECRET",
    classification: "SECRET",
    where: "env",
    carriedBy: "the environment",
    redact: false,
  },
  {
    key: "FIELD_ENCRYPTION_KEY",
    classification: "SECRET",
    where: "env",
    carriedBy: "the environment",
    redact: false,
  },
  {
    key: "GOOGLE_CLIENT_SECRET",
    classification: "SECRET",
    where: "env",
    carriedBy: "the environment",
    redact: false,
  },
  {
    key: "DATABASE_URL",
    classification: "SECRET",
    where: "env",
    carriedBy: "the environment; it holds the database password",
    redact: false,
  },
  {
    key: "REDIS_URL",
    classification: "SECRET",
    where: "env",
    carriedBy: "the environment; it may hold a password",
    redact: false,
  },
] as const satisfies readonly SensitiveField[];

export type SensitiveKey = (typeof SENSITIVE_FIELDS)[number]["key"];

/** The keys the logger censors by name, wherever they appear. */
export const REDACTED_KEYS: readonly string[] = SENSITIVE_FIELDS.filter(
  (field) => field.redact,
).map((field) => field.key);
