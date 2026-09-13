import { z } from "zod";

import { apiOrigin } from "@/lib/api-origin";

/*
  The auth client the sign-up, log-in, recovery and account screens talk to.

  It calls the API directly, not through a Next route handler, because the
  session is a cookie the API sets itself. That works in the browser only
  because the two are SAME-SITE: localhost:3000 and localhost:3001 in
  development, birq.com and api.birq.com in production. Ports are not part of
  "site", so a different port is fine; a different host is not. Point
  NEXT_PUBLIC_API_URL at 127.0.0.1 while the page is on localhost and every
  request still succeeds, but the SameSite=Lax session cookie is silently
  dropped and you appear signed out forever.

  The response shapes are re-declared here rather than imported from
  @abay/contracts on purpose: the browser bundle stays independent of the
  API's build, the same way the password checklist in schemas.ts mirrors the
  server's policy instead of importing it. Only the fields this app reads are
  declared; anything else the API sends is ignored.
*/

/** A slow network should surface as an error, not a button that spins forever. */
const REQUEST_TIMEOUT_MS = 15_000;
/** A photograph over a mobile connection needs far longer than a form does. */
const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Mirrors KYC_IMAGE_MAX_BYTES on the server. Checked here first because a
 * server refusing a body for its size answers 413 and drops the connection
 * mid-upload, which a browser reports as a network failure rather than as
 * the refusal it was; the same sentence, said before a byte is sent, is
 * simply true.
 */
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "INVALID_CODE"
  /** A field was wrong. Distinct from INVALID_CREDENTIALS: nothing was rejected about who you are. */
  | "VALIDATION"
  | "RATE_LIMITED"
  | "CONFLICT"
  /** Signed in, and not allowed to do this one. Verification, or a security cooldown. */
  | "FORBIDDEN"
  /** The balance will not cover it. Its own code so a screen can point at the amount. */
  | "INSUFFICIENT_FUNDS"
  | "NOT_FOUND"
  | "NOT_AVAILABLE"
  | "NETWORK"
  | "SERVER";

export type AuthResult = { ok: true } | { ok: false; code: AuthErrorCode; message: string };

export type KycStatus = "NOT_STARTED" | "PENDING" | "APPROVED" | "REJECTED";
export type KycDocumentType = "NATIONAL_ID" | "PASSPORT" | "DRIVERS_LICENSE";
/** The photographs a submission is made of. */
export type KycDocumentKind = "FRONT" | "BACK" | "SELFIE";

/** A photograph the API has kept, waiting for the submission that names it. */
export type KycDocument = { id: string; kind: KycDocumentKind };

/** Where verification stands, why it was refused, and what is already uploaded. */
export type KycState = {
  status: KycStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  /** The staging area, so a form abandoned halfway can be picked up again. */
  documents: KycDocument[];
};

export type KycResult =
  { ok: true; state: KycState } | { ok: false; code: AuthErrorCode; message: string };

export type KycDocumentResult =
  { ok: true; document: KycDocument } | { ok: false; code: AuthErrorCode; message: string };

export type NotificationType = "KYC_APPROVED" | "KYC_REJECTED" | "DEPOSIT_CREDITED";

/** What the account was told without doing anything on this device. */
export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationsResult =
  | { ok: true; notifications: NotificationItem[]; unreadCount: number }
  | { ok: false; code: AuthErrorCode; message: string };

export type UserStatus = "ACTIVE" | "SUSPENDED" | "CLOSED";

export type SessionUser = {
  id: string;
  email: string;
  /** The customer-facing account number, "BQ-" and eight digits. Never changes. */
  platformId: string;
  username: string;
  status: UserStatus;
  emailVerified: boolean;
  /** Drives what the account may do, and the verification prompt on the home page. */
  kycStatus: KycStatus;
};

export type SessionResult =
  { ok: true; user: SessionUser } | { ok: false; code: AuthErrorCode; message: string };

/*
  Every flow is: prove something, get a ticket, spend the ticket. The tickets
  never leave this module (see below), so the pages only ever pass along what
  the person typed.
*/
export interface AuthClient {
  startRegistration(input: { email: string }): Promise<AuthResult>;
  verifyEmailCode(input: { email: string; code: string }): Promise<AuthResult>;
  resendEmailCode(input: { email: string }): Promise<AuthResult>;
  completeRegistration(input: { password: string }): Promise<SessionResult>;

  startLogin(input: { email: string }): Promise<AuthResult>;
  /** A correct password sends a code to the inbox. The session comes with verifyLogin. */
  login(input: { email: string; password: string }): Promise<AuthResult>;
  verifyLogin(input: { code: string }): Promise<SessionResult>;
  resendLoginCode(): Promise<AuthResult>;

  requestPasswordReset(input: { email: string }): Promise<AuthResult>;
  verifyPasswordResetCode(input: { email: string; code: string }): Promise<AuthResult>;
  /** Ends every session the account has. The person logs in again with the new password. */
  completePasswordReset(input: { password: string }): Promise<AuthResult>;

  /** Leaves the page for Google. A failure comes back as ?error= on /login. */
  continueWithGoogle(): Promise<AuthResult>;

  /** Who the session cookie belongs to, or a signed-out result. Never throws. */
  me(): Promise<SessionResult>;
  logout(): Promise<AuthResult>;

  /** Changes the username. Resolves with the updated user. */
  updateUsername(input: { username: string }): Promise<SessionResult>;

  /** Where identity verification stands, including anything already uploaded. */
  kycState(): Promise<KycResult>;
  /** The bytes of one photograph already uploaded, for a preview. Null if it is gone. */
  kycPhoto(input: { id: string }): Promise<Blob | null>;
  /**
   * Sends one photograph, as the image itself. Progress is reported as a
   * fraction of the bytes sent, for a bar; the id that comes back is what the
   * submission refers to.
   */
  uploadKycDocument(input: {
    kind: KycDocumentKind;
    file: Blob;
    onProgress?: ((fraction: number) => void) | undefined;
  }): Promise<KycDocumentResult>;
  /** Sends the details, naming the photographs already uploaded, for an administrator to review. */
  submitKyc(input: {
    legalName: string;
    dateOfBirth: string;
    documentType: KycDocumentType;
    documentNumber: string;
    documents: { front: string; back?: string | undefined; selfie: string };
  }): Promise<KycResult>;

  /** Newest first, and how many are unread. */
  notifications(): Promise<NotificationsResult>;
  /** No payload to speak of, so not a Result: it worked, or here is why not. */
  markNotificationRead(id: string): Promise<AuthResult>;
  markAllNotificationsRead(): Promise<AuthResult>;
}

const notificationTypeSchema = z.enum(["KYC_APPROVED", "KYC_REJECTED", "DEPOSIT_CREDITED"]);
const notificationItemSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
const notificationsResponseSchema = z.object({
  notifications: z.array(notificationItemSchema),
  unreadCount: z.number(),
});

const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  platformId: z.string(),
  username: z.string(),
  status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]),
  emailVerified: z.boolean(),
  kycStatus: z.enum(["NOT_STARTED", "PENDING", "APPROVED", "REJECTED"]),
});

const kycDocumentSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["FRONT", "BACK", "SELFIE"]),
});
const kycStateSchema = z.object({
  status: z.enum(["NOT_STARTED", "PENDING", "APPROVED", "REJECTED"]),
  submittedAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  documents: z.array(kycDocumentSchema),
});
const sessionResponseSchema = z.object({ user: sessionUserSchema });
const ticketResponseSchema = z.object({ ticket: z.string().min(1) });

/** The API's error envelope. Its `message` is written to be shown to a person. */
const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

/*
  The tickets the server hands back mid-flow. They are held here, in the
  module, rather than in React state: each is a credential for an in-progress
  sign-up, sign-in or reset, and keeping them out of component state keeps
  them out of props, out of the React tree, and out of anything that gets
  serialised into the page. They die with the tab, and the server expires them
  in minutes regardless.
*/
const tickets: { registration: string | null; login: string | null; reset: string | null } = {
  registration: null,
  login: null,
  reset: null,
};

/*
  The CSRF token for whatever session this tab is holding.

  The API hands it back in the x-csrf-token header of every response that
  resolved or issued a session, and every request that can change something
  sends it back in the same header. It is derived from the session token, which
  lives in an httpOnly cookie, so a page on another origin cannot work it out -
  which is the whole point (see apps/api/src/common/security/csrf.ts).

  In a variable rather than a cookie or storage, for the same reason as the
  tickets above: nothing at rest to steal, nothing for another subdomain to
  read, and it dies with the tab. Refreshed on every response that carries one,
  so it cannot go stale while the session behind it is still the same.
*/
let csrfToken: string | null = null;

/** Picks up a token the API just issued. Called for every response, including failures. */
function rememberCsrfToken(headers: Headers): void {
  const token = headers.get("x-csrf-token");
  if (token) csrfToken = token;
}

/*
  Only on the methods that need it. Putting a custom header on a GET would cost
  it a CORS preflight it does not currently need, and a GET cannot change
  anything, so there is nothing for a token to protect.
*/
function csrfHeader(method: string | undefined): Record<string, string> {
  const unsafe = method !== undefined && method.toUpperCase() !== "GET";
  return unsafe && csrfToken ? { "x-csrf-token": csrfToken } : {};
}

export type Failure = { ok: false; code: AuthErrorCode; message: string };

const failure = (code: AuthErrorCode, message: string): Failure => ({ ok: false, code, message });

const OFFLINE = failure(
  "NETWORK",
  "We could not reach the server. Check your connection and try again.",
);

const UNEXPECTED = failure("SERVER", "Something went wrong on our side. Please try again.");

const PHOTO_TOO_LARGE = failure(
  "SERVER",
  "That photo is too large. Take it again, or choose a file under 10 MB.",
);

const EXPIRED = (what: string) =>
  failure("INVALID_CODE", `Your ${what} has expired. Start again to get a new code.`);

/*
  One request helper for the whole client. Returns the parsed body on success
  and a displayable failure otherwise; it never throws, so no caller needs a
  try/catch around a form submission.
*/
export async function send<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit,
): Promise<{ ok: true; data: T } | Failure> {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin()}${path}`, {
      ...init,
      headers: {
        // Only when there is something to declare a type for. Fastify rejects a
        // request that announces JSON and then sends an empty body, which is
        // exactly what a bodiless POST like logout is, and it also spares the
        // GETs a CORS preflight they would otherwise need.
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...csrfHeader(init.method),
        ...init.headers,
      },
      // Without this the session cookie is neither stored nor sent.
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Offline, DNS failure, a CORS rejection, or the timeout above. The browser
    // deliberately tells script nothing more specific than "it failed".
    return OFFLINE;
  }

  rememberCsrfToken(response.headers);

  const text = await response.text();
  if (!response.ok) return failureFrom(response.status, text);

  // An empty body parses as undefined, which is what the `empty` schema expects.
  const parsed = schema.safeParse(parseJson(text));
  if (!parsed.success) return UNEXPECTED;
  return { ok: true, data: parsed.data };
}

function post<T>(path: string, body: unknown, schema: z.ZodType<T>) {
  return send(path, schema, { method: "POST", body: JSON.stringify(body) });
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/*
  Maps the API's stable error code onto ours. The server's message is used as
  written: every message an AppError carries is chosen to be safe to show, and
  rewriting them here would let the two drift apart. The exceptions are a
  validation failure, where the field-level detail says far more than the
  envelope's generic sentence, and a body the server refused for its size,
  where the server's sentence is about bytes and the person's is about a photo.
*/
function failureFrom(status: number, text: string): Failure {
  const parsed = apiErrorSchema.safeParse(parseJson(text));
  if (!parsed.success) {
    return status >= 500 ? UNEXPECTED : failure("SERVER", "That request was rejected.");
  }

  const { code, message, details } = parsed.data.error;
  switch (code) {
    case "UNAUTHENTICATED":
      return failure("INVALID_CREDENTIALS", message);
    case "CONFLICT":
      return failure("CONFLICT", message);
    case "RATE_LIMITED":
      return failure("RATE_LIMITED", message);
    case "VALIDATION_FAILED":
      return failure("VALIDATION", details?.[0]?.message ?? message);
    case "FORBIDDEN":
      return failure("FORBIDDEN", message);
    case "INSUFFICIENT_FUNDS":
      return failure("INSUFFICIENT_FUNDS", message);
    case "NOT_FOUND":
      return failure("NOT_FOUND", message);
    case "PAYLOAD_TOO_LARGE":
      return PHOTO_TOO_LARGE;
    case "NOT_READY":
      // "We could not send the email": the server's sentence is the useful one.
      return failure("SERVER", message);
    case "CSRF_FAILED":
      /*
        This tab is holding a token for a session that is no longer the one in
        the cookie jar - signing in as somebody else in another tab is the way
        it happens. The server's sentence says to reload, which is right: the
        rest of what is on screen belongs to the previous session too.
      */
      return failure("SERVER", message);
    default:
      return UNEXPECTED;
  }
}

/** A code rejection, whatever the reason, is one message on the server; it stays one here. */
const asCodeFailure = (result: Failure): Failure =>
  result.code === "INVALID_CREDENTIALS" || result.code === "VALIDATION"
    ? failure("INVALID_CODE", result.message)
    : result;

/** 202 Accepted, with a body this client has no use for. */
const ignored = z.unknown();
/** 204 No Content. */
const empty = z.undefined();

export const apiAuthClient: AuthClient = {
  /* --------------------------------------------------------- notifications */

  async notifications() {
    const result = await send("/v1/notifications", notificationsResponseSchema, { method: "GET" });
    return result.ok
      ? { ok: true, notifications: result.data.notifications, unreadCount: result.data.unreadCount }
      : result;
  },

  async markNotificationRead(id) {
    const result = await send(`/v1/notifications/${id}/read`, empty, { method: "POST" });
    return result.ok ? { ok: true } : result;
  },

  async markAllNotificationsRead() {
    const result = await send("/v1/notifications/read-all", empty, { method: "POST" });
    return result.ok ? { ok: true } : result;
  },

  /* ---------------------------------------------------------------- sign-up */

  async startRegistration({ email }) {
    const result = await post("/v1/auth/register/start", { email }, ignored);
    return result.ok ? { ok: true } : result;
  },

  async verifyEmailCode({ email, code }) {
    const result = await post("/v1/auth/register/verify", { email, code }, ticketResponseSchema);
    if (!result.ok) return asCodeFailure(result);
    tickets.registration = result.data.ticket;
    return { ok: true };
  },

  async resendEmailCode({ email }) {
    // Same endpoint as step 1: issuing a new code retires the previous one.
    const result = await post("/v1/auth/register/start", { email }, ignored);
    return result.ok ? { ok: true } : result;
  },

  async completeRegistration({ password }) {
    const ticket = tickets.registration;
    if (!ticket) return EXPIRED("sign-up");
    const result = await post(
      "/v1/auth/register/complete",
      { ticket, password },
      sessionResponseSchema,
    );
    // Single use on the server, so single use here too: a retry has to start
    // from a fresh code rather than replay a ticket that is already spent.
    tickets.registration = null;
    return result.ok ? { ok: true, user: result.data.user } : result;
  },

  /* ----------------------------------------------------------------- log-in */

  /*
    Deliberately does not call the server. There is no "does this address
    exist" endpoint and there must not be one: it would answer the single
    question the whole flow is shaped to avoid answering. The email step is a
    UI step; the password step is where the server first gets a say.
  */
  async startLogin() {
    return { ok: true };
  },

  async login({ email, password }) {
    const result = await post("/v1/auth/login", { email, password }, ticketResponseSchema);
    if (!result.ok) return result;
    tickets.login = result.data.ticket;
    return { ok: true };
  },

  async verifyLogin({ code }) {
    const ticket = tickets.login;
    if (!ticket) return EXPIRED("sign-in");
    const result = await post("/v1/auth/login/verify", { ticket, code }, sessionResponseSchema);
    if (!result.ok) return asCodeFailure(result);
    tickets.login = null;
    return { ok: true, user: result.data.user };
  },

  async resendLoginCode() {
    const ticket = tickets.login;
    if (!ticket) return EXPIRED("sign-in");
    const result = await post("/v1/auth/login/resend", { ticket }, ignored);
    return result.ok ? { ok: true } : result;
  },

  /* ---------------------------------------------------------- password reset */

  async requestPasswordReset({ email }) {
    const result = await post("/v1/auth/password-reset", { email }, ignored);
    return result.ok ? { ok: true } : result;
  },

  async verifyPasswordResetCode({ email, code }) {
    const result = await post(
      "/v1/auth/password-reset/verify",
      { email, code },
      ticketResponseSchema,
    );
    if (!result.ok) return asCodeFailure(result);
    tickets.reset = result.data.ticket;
    return { ok: true };
  },

  async completePasswordReset({ password }) {
    const ticket = tickets.reset;
    if (!ticket) return EXPIRED("reset");
    const result = await post("/v1/auth/password-reset/complete", { ticket, password }, ignored);
    tickets.reset = null;
    return result.ok ? { ok: true } : result;
  },

  /* ----------------------------------------------------------------- google */

  continueWithGoogle() {
    // A top-level navigation, so the API can set the session cookie on the
    // way back. No Google script runs in this page and no token ever reaches
    // it. The promise never settles because the page is leaving: the button
    // stays busy until it does, and a failure comes back as ?error= on /login.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the API's origin, never a Next page
    window.location.href = `${apiOrigin()}/v1/auth/google/start`;
    return new Promise<AuthResult>(() => {});
  },

  /* ---------------------------------------------------------------- session */

  async me() {
    const result = await send("/v1/auth/me", sessionResponseSchema, { method: "GET" });
    return result.ok ? { ok: true, user: result.data.user } : result;
  },

  async logout() {
    const result = await send("/v1/auth/logout", empty, { method: "POST" });
    return result.ok ? { ok: true } : result;
  },

  /* ---------------------------------------------------------------- profile */

  async updateUsername({ username }) {
    const result = await send("/v1/auth/me", sessionResponseSchema, {
      method: "PATCH",
      body: JSON.stringify({ username }),
    });
    return result.ok ? { ok: true, user: result.data.user } : result;
  },

  /* -------------------------------------------------------------------- kyc */

  async kycState() {
    const result = await send("/v1/kyc", kycStateSchema, { method: "GET" });
    return result.ok ? { ok: true, state: result.data } : result;
  },

  /*
    A preview of a photograph already uploaded. Fetched rather than pointed at
    with an <img src>, so it travels the same credentialed path as every other
    call in this module; the caller turns the blob into an object URL exactly
    as it would for a photo just taken, and the rest of the flow cannot tell
    the two apart.

    Null rather than a displayable failure: a preview that will not load is
    not worth a sentence on screen. The slot shows empty and the person takes
    that one again.
  */
  async kycPhoto({ id }) {
    try {
      const response = await fetch(`${apiOrigin()}/v1/kyc/documents/${id}`, {
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      rememberCsrfToken(response.headers);
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null;
    }
  },

  /*
    XMLHttpRequest rather than fetch, for one reason: fetch cannot report
    upload progress, and a photograph over a mobile connection takes long
    enough that a bar is the difference between waiting and giving up. The
    body is the image itself, under its own content type; nothing is wrapped
    in a form.
  */
  async uploadKycDocument({ kind, file, onProgress }) {
    if (file.size > PHOTO_MAX_BYTES) return PHOTO_TOO_LARGE;
    const outcome = await new Promise<{ status: number; text: string } | null>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${apiOrigin()}/v1/kyc/documents/${kind.toLowerCase()}`);
      xhr.withCredentials = true;
      xhr.timeout = UPLOAD_TIMEOUT_MS;
      xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
      // Same token as every other mutation; this one only looks different
      // because progress reporting needs XMLHttpRequest rather than fetch.
      if (csrfToken) xhr.setRequestHeader("x-csrf-token", csrfToken);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
      };
      xhr.onload = () => {
        const token = xhr.getResponseHeader("x-csrf-token");
        if (token) csrfToken = token;
        resolve({ status: xhr.status, text: xhr.responseText });
      };
      xhr.onerror = () => resolve(null);
      xhr.ontimeout = () => resolve(null);
      xhr.onabort = () => resolve(null);
      xhr.send(file);
    });
    if (!outcome) return OFFLINE;
    if (outcome.status < 200 || outcome.status >= 300) {
      return failureFrom(outcome.status, outcome.text);
    }
    const parsed = kycDocumentSchema.safeParse(parseJson(outcome.text));
    if (!parsed.success) return UNEXPECTED;
    return { ok: true, document: parsed.data };
  },

  async submitKyc(input) {
    const result = await post("/v1/kyc", input, kycStateSchema);
    return result.ok ? { ok: true, state: result.data } : result;
  },
};

export const authClient: AuthClient = apiAuthClient;

/** The sentence for a ?error=google_<reason> on the log-in page, or null for anything else. */
export function googleErrorMessage(error: string | null): string | null {
  switch (error) {
    case "google_denied":
      return "Google sign-in was cancelled. Try again, or use your email address.";
    case "google_unavailable":
      return "Google sign-in is not available yet. Use your email address for now.";
    case "google_unverified_email":
      return "That Google account's email address is not verified, so it cannot be used here.";
    case "google_closed":
      return "That account is closed.";
    case "google_expired":
      return "That Google sign-in took too long. Try again.";
    case "google_failed":
      return "Google sign-in did not complete. Try again, or use your email address.";
    default:
      return null;
  }
}
