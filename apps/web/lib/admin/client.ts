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
  "KYC_REVIEWER" | "DISPUTE_RESOLVER" | "WITHDRAWAL_APPROVER" | "FINANCIAL_ADJUSTER";

export type AdminIdentity = {
  id: string;
  email: string;
  name: string;
  roles: AdminRole[];
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

export type Failure = {
  ok: false;
  code: "AUTH" | "FORBIDDEN" | "CONFLICT" | "OTHER";
  message: string;
};
export type Result<T> = ({ ok: true } & T) | Failure;

const role = z.enum([
  "KYC_REVIEWER",
  "DISPUTE_RESOLVER",
  "WITHDRAWAL_APPROVER",
  "FINANCIAL_ADJUSTER",
]);

const identitySchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  roles: z.array(role),
});
const sessionSchema = z.object({ admin: identitySchema });

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

const fail = (code: Failure["code"], message: string): Failure => ({ ok: false, code, message });
const OFFLINE = fail("OTHER", "We could not reach the server. Check your connection.");
const UNEXPECTED = fail("OTHER", "Something went wrong. Please try again.");

async function send<T>(
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
        ...init.headers,
      },
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return OFFLINE;
  }

  const text = await response.text();
  if (!response.ok) {
    const parsed = errorSchema.safeParse(text ? (JSON.parse(text) as unknown) : undefined);
    if (!parsed.success) return UNEXPECTED;
    const { code, message, details } = parsed.data.error;
    if (code === "UNAUTHENTICATED") return fail("AUTH", message);
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
  }): Promise<Result<{ admin: AdminIdentity }>> {
    const result = await send("/auth/login", sessionSchema, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return result.ok ? { ok: true, admin: result.data.admin } : result;
  },

  async me(): Promise<Result<{ admin: AdminIdentity }>> {
    const result = await send("/auth/me", sessionSchema, { method: "GET" });
    return result.ok ? { ok: true, admin: result.data.admin } : result;
  },

  /** No payload to speak of, so not a Result: it worked, or here is why not. */
  async logout(): Promise<{ ok: true } | Failure> {
    const result = await send("/auth/logout", z.undefined(), { method: "POST" });
    return result.ok ? { ok: true } : result;
  },

  async queue(): Promise<Result<{ submissions: KycReviewItem[]; pending: number }>> {
    const result = await send("/kyc/queue", queueSchema, { method: "GET" });
    return result.ok
      ? { ok: true, submissions: result.data.submissions, pending: result.data.pending }
      : result;
  },

  async submission(id: string): Promise<Result<{ submission: KycReviewItem }>> {
    const result = await send(`/kyc/submissions/${id}`, reviewItemSchema, { method: "GET" });
    return result.ok ? { ok: true, submission: result.data } : result;
  },

  /** The photograph itself, as a blob the caller turns into an object URL. */
  async photo(submissionId: string, documentId: string): Promise<Blob | null> {
    try {
      const response = await fetch(
        `${apiOrigin()}/v1/admin/kyc/submissions/${submissionId}/documents/${documentId}`,
        { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null;
    }
  },

  async approve(id: string, note: string): Promise<Result<{ submission: KycReviewItem }>> {
    const result = await send(`/kyc/submissions/${id}/approve`, reviewItemSchema, {
      method: "POST",
      body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
    });
    return result.ok ? { ok: true, submission: result.data } : result;
  },

  async reject(id: string, reason: string): Promise<Result<{ submission: KycReviewItem }>> {
    const result = await send(`/kyc/submissions/${id}/reject`, reviewItemSchema, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    return result.ok ? { ok: true, submission: result.data } : result;
  },
};
