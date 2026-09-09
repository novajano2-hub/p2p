import { z } from "zod";

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

const CONFIGURED_API_URL = readApiUrl();

/*
  Loopback names mean "this machine", so they are only correct for a page that
  is itself being served from one. Open the dev server by its LAN address to
  try something on a phone and a configured http://localhost:3001 becomes two
  bugs at once: the browser looks for the API on the phone, and the session
  cookie becomes cross-site (localhost vs 192.168.x.x are different sites) and
  is dropped without an error anywhere. So when the API is configured under a
  loopback name and the page is not on one, the page's own hostname wins.

  A configured hostname that is not loopback is never touched: in production
  the API deliberately lives on a different host from the page (api.birq.com
  beside birq.com), which is same-site and works as intended.
*/
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function apiOrigin(): string {
  if (typeof window === "undefined") return CONFIGURED_API_URL;
  const configured = new URL(CONFIGURED_API_URL);
  const pageHost = window.location.hostname;
  if (pageHost === configured.hostname || !LOOPBACK_HOSTS.has(configured.hostname)) {
    return configured.origin;
  }
  configured.protocol = window.location.protocol;
  configured.hostname = pageHost;
  return configured.origin;
}

function readApiUrl(): string {
  // Inlined at build time. No fallback on purpose: a wrong guess here fails
  // silently at the cookie layer, so a missing value fails loudly instead.
  const value = process.env.NEXT_PUBLIC_API_URL;
  if (!value) {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. Copy apps/web/.env.example to apps/web/.env.local.",
    );
  }
  return value.replace(/\/+$/, "");
}

/** A slow network should surface as an error, not a button that spins forever. */
const REQUEST_TIMEOUT_MS = 15_000;

export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "INVALID_CODE"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "NOT_AVAILABLE"
  | "NETWORK"
  | "SERVER";

export type AuthResult = { ok: true } | { ok: false; code: AuthErrorCode; message: string };

export type UserStatus = "ACTIVE" | "SUSPENDED" | "CLOSED";

export type SessionUser = {
  id: string;
  email: string;
  /** The customer-facing account number, "BQ-" and eight digits. Never changes. */
  platformId: string;
  username: string;
  status: UserStatus;
  emailVerified: boolean;
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
}

const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  platformId: z.string(),
  username: z.string(),
  status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]),
  emailVerified: z.boolean(),
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

type Failure = { ok: false; code: AuthErrorCode; message: string };

const failure = (code: AuthErrorCode, message: string): Failure => ({ ok: false, code, message });

const OFFLINE = failure(
  "NETWORK",
  "We could not reach the server. Check your connection and try again.",
);

const UNEXPECTED = failure("SERVER", "Something went wrong on our side. Please try again.");

const EXPIRED = (what: string) =>
  failure("INVALID_CODE", `Your ${what} has expired. Start again to get a new code.`);

/*
  One request helper for the whole client. Returns the parsed body on success
  and a displayable failure otherwise; it never throws, so no caller needs a
  try/catch around a form submission.
*/
async function send<T>(
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

  if (!response.ok) return await toFailure(response);

  // An empty body parses as undefined, which is what the `empty` schema expects.
  const parsed = schema.safeParse(await readJson(response));
  if (!parsed.success) return UNEXPECTED;
  return { ok: true, data: parsed.data };
}

function post<T>(path: string, body: unknown, schema: z.ZodType<T>) {
  return send(path, schema, { method: "POST", body: JSON.stringify(body) });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
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
  rewriting them here would let the two drift apart. The exception is a
  validation failure, where the field-level detail says far more than the
  envelope's generic sentence.
*/
async function toFailure(response: Response): Promise<Failure> {
  const parsed = apiErrorSchema.safeParse(await readJson(response));
  if (!parsed.success) {
    return response.status >= 500 ? UNEXPECTED : failure("SERVER", "That request was rejected.");
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
      return failure("INVALID_CREDENTIALS", details?.[0]?.message ?? message);
    case "NOT_READY":
      // "We could not send the email": the server's sentence is the useful one.
      return failure("SERVER", message);
    default:
      return UNEXPECTED;
  }
}

/** A code rejection, whatever the reason, is one message on the server; it stays one here. */
const asCodeFailure = (result: Failure): Failure =>
  result.code === "INVALID_CREDENTIALS" ? failure("INVALID_CODE", result.message) : result;

/** 202 Accepted, with a body this client has no use for. */
const ignored = z.unknown();
/** 204 No Content. */
const empty = z.undefined();

export const apiAuthClient: AuthClient = {
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
