import { z } from "zod";

import { apiOrigin } from "@/lib/api-origin";

/*
  The administrator's client, kept apart from the customer's on purpose.

  Nothing is shared but the origin. Separate module, separate types, separate
  cookie doing the work on the wire: the same separation the API has between
  the two realms, mirrored here so that no screen can accidentally hold both
  kinds of session or call the wrong side with the wrong one.
*/

const TIMEOUT_MS = 15_000;

export type AdminRole =
  | "KYC_REVIEWER"
  | "DISPUTE_RESOLVER"
  | "WITHDRAWAL_APPROVER"
  | "FINANCIAL_ADJUSTER"
  | "LEDGER_VIEWER";

export type AdminIdentity = {
  id: string;
  email: string;
  name: string;
  roles: AdminRole[];
  /** False until an authenticator app has been confirmed. The shell gates on it. */
  mfaEnrolled: boolean;
};

export type KycDocumentKind = "FRONT" | "BACK" | "SELFIE";

export type KycReviewItem = {
  id: string;
  status: "NOT_STARTED" | "PENDING" | "APPROVED" | "REJECTED";
  submittedAt: string;
  reviewedAt: string | null;
  account: { userId: string; platformId: string; username: string; email: string };
  legalName: string;
  dateOfBirth: string;
  country: string;
  documentType: "NATIONAL_ID" | "PASSPORT" | "DRIVERS_LICENSE";
  documentNumber: string;
  documents: { id: string; kind: KycDocumentKind }[];
};

/*
  The closed set of reasons a submission may be rejected for, mirroring
  kycRejectionReason in @abay/contracts (re-declared, like every other shape
  in this client, so the browser bundle stays independent of the API's
  build). The label is the exact sentence the customer will read - shown to
  the administrator as the option itself, not a paraphrase of it, because
  choosing a reason and knowing what it says to the customer should be the
  same act.
*/
export const KYC_REJECTION_REASONS = {
  PHOTO_UNREADABLE: "The photo of your document is too blurry, dark, or glared to read clearly.",
  PHOTO_INCOMPLETE: "The photo does not show the whole document. All four corners must be visible.",
  NAME_MISMATCH: "The name you entered does not match the name printed on your document.",
  DATE_OF_BIRTH_MISMATCH: "The date of birth you entered does not match your document.",
  DOCUMENT_NUMBER_MISMATCH: "The document number you entered does not match your document.",
  DOCUMENT_EXPIRED: "Your document has expired. Submit one that is still valid.",
  SELFIE_MISMATCH: "The person in the selfie does not clearly match the photo on the document.",
  SELFIE_MISSING_DOCUMENT:
    "Your selfie must show you holding the document, with both your face and the document readable.",
  DOCUMENT_TYPE_NOT_SUPPORTED:
    "This is not a document type we can verify. Use a national ID, passport, or driver's licence.",
  NOT_ETHIOPIAN_DOCUMENT: "We can only verify Ethiopian documents at this time.",
  SUSPECTED_ALTERED: "The document appears to have been altered or edited.",
  OTHER: "Check that your details and photos match your document exactly, then try again.",
} as const;

export type KycRejectionReason = keyof typeof KYC_REJECTION_REASONS;

export type Failure = {
  ok: false;
  /** "MFA": the password was right and a 6-digit code is (also) needed. */
  code: "AUTH" | "MFA" | "FORBIDDEN" | "CONFLICT" | "OTHER";
  message: string;
};
export type Result<T> = ({ ok: true } & T) | Failure;

const role = z.enum([
  "KYC_REVIEWER",
  "DISPUTE_RESOLVER",
  "WITHDRAWAL_APPROVER",
  "FINANCIAL_ADJUSTER",
  "LEDGER_VIEWER",
]);

const identitySchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  roles: z.array(role),
  mfaEnrolled: z.boolean(),
});
const sessionSchema = z.object({ admin: identitySchema });
const mfaSetupSchema = z.object({ secret: z.string(), otpauthUri: z.string() });

const reviewItemSchema = z.object({
  id: z.string(),
  status: z.enum(["NOT_STARTED", "PENDING", "APPROVED", "REJECTED"]),
  submittedAt: z.string(),
  reviewedAt: z.string().nullable(),
  account: z.object({
    userId: z.string(),
    platformId: z.string(),
    username: z.string(),
    email: z.string(),
  }),
  legalName: z.string(),
  dateOfBirth: z.string(),
  country: z.string(),
  documentType: z.enum(["NATIONAL_ID", "PASSPORT", "DRIVERS_LICENSE"]),
  documentNumber: z.string(),
  documents: z.array(z.object({ id: z.string(), kind: z.enum(["FRONT", "BACK", "SELFIE"]) })),
});
const queueSchema = z.object({
  submissions: z.array(reviewItemSchema),
  pending: z.number(),
});

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

/*
  The CSRF token for the administrator session this tab is holding, kept apart
  from the customer client's for the same reason everything else here is: the
  API derives a different token for each realm, so one is meaningless in the
  other and neither module can hand the wrong one over.

  A variable, not a cookie. The admin session cookie is deliberately host-only
  on the API host, so a cookie-delivered token could not be read by script here
  at all; a header has no such scope, and nothing is left at rest to steal.
*/
let csrfToken: string | null = null;

function rememberCsrfToken(headers: Headers): void {
  const token = headers.get("x-csrf-token");
  if (token) csrfToken = token;
}

/** Only on the methods that can change something; a GET would pay for a preflight. */
function csrfHeader(method: string | undefined): Record<string, string> {
  const unsafe = method !== undefined && method.toUpperCase() !== "GET";
  return unsafe && csrfToken ? { "x-csrf-token": csrfToken } : {};
}

const fail = (code: Failure["code"], message: string): Failure => ({ ok: false, code, message });
const OFFLINE = fail("OTHER", "We could not reach the server. Check your connection.");
const UNEXPECTED = fail("OTHER", "Something went wrong. Please try again.");

/** One request to the admin API, parsed by a schema. Shared with lib/admin/ledger.ts. */
export async function adminRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit,
): Promise<{ ok: true; data: T } | Failure> {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin()}/v1/admin${path}`, {
      ...init,
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...csrfHeader(init.method),
        ...init.headers,
      },
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return OFFLINE;
  }

  rememberCsrfToken(response.headers);

  const text = await response.text();
  if (!response.ok) {
    const parsed = errorSchema.safeParse(text ? (JSON.parse(text) as unknown) : undefined);
    if (!parsed.success) return UNEXPECTED;
    const { code, message, details } = parsed.data.error;
    if (code === "UNAUTHENTICATED") return fail("AUTH", message);
    if (code === "MFA_REQUIRED") return fail("MFA", message);
    if (code === "FORBIDDEN") return fail("FORBIDDEN", message);
    if (code === "CONFLICT") return fail("CONFLICT", message);
    if (code === "VALIDATION_FAILED") return fail("OTHER", details?.[0]?.message ?? message);
    return fail("OTHER", message);
  }

  const parsed = schema.safeParse(text ? (JSON.parse(text) as unknown) : undefined);
  if (!parsed.success) return UNEXPECTED;
  return { ok: true, data: parsed.data };
}

export const adminClient = {
  async login(input: {
    email: string;
    password: string;
    /** Only once the server has answered MFA: the first attempt goes without. */
    code?: string;
  }): Promise<Result<{ admin: AdminIdentity }>> {
    const result = await adminRequest("/auth/login", sessionSchema, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return result.ok ? { ok: true, admin: result.data.admin } : result;
  },

  async me(): Promise<Result<{ admin: AdminIdentity }>> {
    const result = await adminRequest("/auth/me", sessionSchema, { method: "GET" });
    return result.ok ? { ok: true, admin: result.data.admin } : result;
  },

  /*
    Enrollment. setup stages a fresh secret and hands back the one copy of it
    this client will ever see; confirm proves an app really holds it. Neither
    is reachable without a session, and the confirmed identity comes back so
    the shell can drop its gate without asking again.
  */
  async mfaSetup(): Promise<Result<{ secret: string; otpauthUri: string }>> {
    const result = await adminRequest("/auth/mfa/setup", mfaSetupSchema, {
      method: "POST",
      body: JSON.stringify({}),
    });
    return result.ok
      ? { ok: true, secret: result.data.secret, otpauthUri: result.data.otpauthUri }
      : result;
  },

  async mfaConfirm(code: string): Promise<Result<{ admin: AdminIdentity }>> {
    const result = await adminRequest("/auth/mfa/confirm", sessionSchema, {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    return result.ok ? { ok: true, admin: result.data.admin } : result;
  },

  /** No payload to speak of, so not a Result: it worked, or here is why not. */
  async logout(): Promise<{ ok: true } | Failure> {
    const result = await adminRequest("/auth/logout", z.undefined(), { method: "POST" });
    return result.ok ? { ok: true } : result;
  },

  async queue(): Promise<Result<{ submissions: KycReviewItem[]; pending: number }>> {
    const result = await adminRequest("/kyc/queue", queueSchema, { method: "GET" });
    return result.ok
      ? { ok: true, submissions: result.data.submissions, pending: result.data.pending }
      : result;
  },

  async submission(id: string): Promise<Result<{ submission: KycReviewItem }>> {
    const result = await adminRequest(`/kyc/submissions/${id}`, reviewItemSchema, {
      method: "GET",
    });
    return result.ok ? { ok: true, submission: result.data } : result;
  },

  /** The photograph itself, as a blob the caller turns into an object URL. */
  async photo(submissionId: string, documentId: string): Promise<Blob | null> {
    try {
      const response = await fetch(
        `${apiOrigin()}/v1/admin/kyc/submissions/${submissionId}/documents/${documentId}`,
        { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      rememberCsrfToken(response.headers);
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null;
    }
  },

  /** Nothing to send: approving asks nothing of the administrator. */
  async approve(id: string): Promise<Result<{ submission: KycReviewItem }>> {
    const result = await adminRequest(`/kyc/submissions/${id}/approve`, reviewItemSchema, {
      method: "POST",
      body: JSON.stringify({}),
    });
    return result.ok ? { ok: true, submission: result.data } : result;
  },

  async reject(
    id: string,
    reason: KycRejectionReason,
  ): Promise<Result<{ submission: KycReviewItem }>> {
    const result = await adminRequest(`/kyc/submissions/${id}/reject`, reviewItemSchema, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    return result.ok ? { ok: true, submission: result.data } : result;
  },
};
