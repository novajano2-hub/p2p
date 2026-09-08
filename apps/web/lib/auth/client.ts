import { z } from "zod";

/*
  The auth client the sign-up, log-in and account screens talk to.

  It calls the API directly, not through a Next route handler, because the
  session is a cookie the API sets itself. That works in the browser only
  because the two are SAME-SITE: localhost:3000 and localhost:3001 in
  development, abay.com and api.abay.com in production. Ports are not part of
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

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/+$/, "");

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
  status: UserStatus;
  emailVerified: boolean;
};

export type SessionResult =
  { ok: true; user: SessionUser } | { ok: false; code: AuthErrorCode; message: string };

export interface AuthClient {
  startRegistration(input: { email: string }): Promise<AuthResult>;
  verifyEmailCode(input: { email: string; code: string }): Promise<AuthResult>;
  resendEmailCode(input: { email: string }): Promise<AuthResult>;
  completeRegistration(input: { password: string }): Promise<SessionResult>;
  startLogin(input: { email: string }): Promise<AuthResult>;
  login(input: { email: string; password: string }): Promise<SessionResult>;
  requestPasswordReset(input: { email: string }): Promise<AuthResult>;
  continueWithGoogle(): Promise<AuthResult>;
  /** Who the session cookie belongs to, or a signed-out result. Never throws. */
  me(): Promise<SessionResult>;
  logout(): Promise<AuthResult>;
}

const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]),
  emailVerified: z.boolean(),
});
const sessionResponseSchema = z.object({ user: sessionUserSchema });
const verifyResponseSchema = z.object({ ticket: z.string().min(1) });

/** The API's error envelope. Its `message` is written to be shown to a person. */
const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

/*
  The registration ticket the server hands back at the code step, in exchange
  for the code. It is held here, in the module, rather than in React state: it
  is a credential for an in-progress sign-up, and keeping it out of component
  state keeps it out of props, out of the React tree, and out of anything that
  gets serialised into the page. It dies with the tab, and the server expires
  it after fifteen minutes regardless.
*/
let registrationTicket: string | null = null;

type Failure = { ok: false; code: AuthErrorCode; message: string };

const failure = (code: AuthErrorCode, message: string): Failure => ({ ok: false, code, message });

const OFFLINE = failure(
  "NETWORK",
  "We could not reach the server. Check your connection and try again.",
);

const UNEXPECTED = failure("SERVER", "Something went wrong on our side. Please try again.");

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
    response = await fetch(`${API_URL}${path}`, {
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
    default:
      return UNEXPECTED;
  }
}

/** 202 Accepted, with a body this client has no use for. */
const ignored = z.unknown();
/** 204 No Content. */
const empty = z.undefined();

export const apiAuthClient: AuthClient = {
  async startRegistration({ email }) {
    const result = await post("/v1/auth/register/start", { email }, ignored);
    return result.ok ? { ok: true } : result;
  },

  async verifyEmailCode({ email, code }) {
    const result = await post("/v1/auth/register/verify", { email, code }, verifyResponseSchema);
    if (!result.ok) {
      // A wrong code, an expired code and a burnt code are one message on the
      // server by design; they stay one message here.
      return result.code === "INVALID_CREDENTIALS"
        ? failure("INVALID_CODE", result.message)
        : result;
    }
    registrationTicket = result.data.ticket;
    return { ok: true };
  },

  async resendEmailCode({ email }) {
    // Same endpoint as step 1: issuing a new code retires the previous one.
    const result = await post("/v1/auth/register/start", { email }, ignored);
    return result.ok ? { ok: true } : result;
  },

  async completeRegistration({ password }) {
    if (!registrationTicket) {
      return failure("INVALID_CODE", "Your sign-up has expired. Start again to get a new code.");
    }

    const result = await post(
      "/v1/auth/register/complete",
      { ticket: registrationTicket, password },
      sessionResponseSchema,
    );
    // Single use on the server, so single use here too: a retry has to start
    // from a fresh code rather than replay a ticket that is already spent.
    registrationTicket = null;
    return result.ok ? { ok: true, user: result.data.user } : result;
  },

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
    const result = await post("/v1/auth/login", { email, password }, sessionResponseSchema);
    return result.ok ? { ok: true, user: result.data.user } : result;
  },

  async requestPasswordReset({ email }) {
    const result = await post("/v1/auth/password-reset", { email }, ignored);
    return result.ok ? { ok: true } : result;
  },

  async continueWithGoogle() {
    return failure(
      "NOT_AVAILABLE",
      "Google sign-in is not available yet. Use your email address for now.",
    );
  },

  async me() {
    const result = await send("/v1/auth/me", sessionResponseSchema, { method: "GET" });
    return result.ok ? { ok: true, user: result.data.user } : result;
  },

  async logout() {
    const result = await send("/v1/auth/logout", empty, { method: "POST" });
    return result.ok ? { ok: true } : result;
  },
};

export const authClient: AuthClient = apiAuthClient;
