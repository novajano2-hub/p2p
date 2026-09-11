import {
  KYC_REJECTION_REASONS,
  type KycDocumentKind,
  type KycDocumentType,
  type KycQueueResponse,
  type KycRejectionReason,
  type KycReviewItem,
} from "@abay/contracts";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { AppError } from "@/common/errors/app-error";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { OBJECT_STORE, StorageError, type ObjectStore } from "@/infra/storage/object-store";
import { type AdminSessionContext } from "@/modules/admin/admin-session.service";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";

/*
  The queue an administrator works through, and the two decisions they can make.

  Verification is the one thing in the platform today that a person has to
  decide, and until now the only way to decide it was a command-line script
  that wrote the rows and left no record of who ran it. That script is gone.
  Every decision here names an administrator and commits together with its
  audit event.

  Reading a submission is itself recorded. These are photographs of somebody's
  identity document - RESTRICTED data - and the threat model asks for access to
  them to be attributable (B7.5). "Who looked at this person's passport" is a
  question that should have an answer.
*/

const SUBJECT = "kyc_submission";

@Injectable()
export class AdminKycService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminKycService.name);
  }

  /** Everything still waiting, oldest first: a queue, not a list. */
  async queue(): Promise<KycQueueResponse> {
    const rows = await this.prisma.client.kycSubmission.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 100,
      include: {
        user: { select: { id: true, platformId: true, username: true, email: true } },
        documents: { select: { id: true, kind: true }, orderBy: { kind: "asc" } },
      },
    });

    return { submissions: rows.map(toReviewItem), pending: rows.length };
  }

  /**
   * One submission, in full. Recorded, because this is the moment an
   * administrator sees somebody's identity document.
   */
  async open(
    submissionId: string,
    session: AdminSessionContext,
    context: { correlationId: string; ip?: string | undefined },
  ): Promise<KycReviewItem> {
    const row = await this.prisma.client.kycSubmission.findUnique({
      where: { id: submissionId },
      include: {
        user: { select: { id: true, platformId: true, username: true, email: true } },
        documents: { select: { id: true, kind: true }, orderBy: { kind: "asc" } },
      },
    });
    if (!row) throw AppError.notFound("There is no such submission.");

    await this.audit.record({
      action: "kyc.submission_viewed",
      actor: { id: session.admin.id, email: session.admin.email },
      subject: { type: SUBJECT, id: row.id },
      correlationId: context.correlationId,
      ip: context.ip ?? null,
    });

    return toReviewItem(row);
  }

  /** One photograph, for the reviewer. The only other reader is its owner. */
  async document(
    submissionId: string,
    documentId: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    const document = await this.prisma.client.kycDocument.findFirst({
      // Both ids, so a document id alone cannot be walked from one submission
      // to another, and a mistyped pair is a miss rather than a leak.
      where: { id: documentId, submissionId },
      select: { storageKey: true, contentType: true },
    });
    if (!document) return null;

    let body: Buffer | null;
    try {
      body = await this.store.get(document.storageKey);
    } catch (error) {
      if (error instanceof StorageError) {
        throw AppError.notReady("The document store is not answering. Try again in a moment.");
      }
      throw error;
    }
    if (!body) return null;
    return { body, contentType: document.contentType };
  }

  /** Nothing to say: approving asks nothing of the administrator, and needs no reason. */
  approve(
    submissionId: string,
    session: AdminSessionContext,
    context: { correlationId: string; ip?: string | undefined },
  ): Promise<KycReviewItem> {
    return this.decide(submissionId, "APPROVED", null, session, context);
  }

  /**
   * The reason is a code from a fixed set (kycRejectionReason in
   * @abay/contracts), not a sentence the administrator writes. What is
   * stored and shown to the customer, and what the audit event carries, is
   * the canonical wording for that code - resolved here, once, so the
   * customer always reads the reviewed sentence and never a first draft.
   */
  reject(
    submissionId: string,
    reason: KycRejectionReason,
    session: AdminSessionContext,
    context: { correlationId: string; ip?: string | undefined },
  ): Promise<KycReviewItem> {
    return this.decide(submissionId, "REJECTED", KYC_REJECTION_REASONS[reason], session, context);
  }

  /*
    One decision, applied to the submission and to the account together, with
    its audit event, in one transaction. Either all three land or none does:
    an account marked verified with no record of who verified it is exactly
    the state this realm exists to prevent.

    The update is conditional on the submission still being PENDING. Two
    administrators opening the same one is normal; both deciding it is not,
    and the second is told so rather than silently overwriting the first.
  */
  private async decide(
    submissionId: string,
    outcome: "APPROVED" | "REJECTED",
    reason: string | null,
    session: AdminSessionContext,
    context: { correlationId: string; ip?: string | undefined },
  ): Promise<KycReviewItem> {
    const existing = await this.prisma.client.kycSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, status: true, userId: true },
    });
    if (!existing) throw AppError.notFound("There is no such submission.");
    if (existing.status !== "PENDING") {
      throw AppError.conflict(`This submission was already ${existing.status.toLowerCase()}.`);
    }

    const decidedAt = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      const changed = await tx.kycSubmission.updateMany({
        where: { id: submissionId, status: "PENDING" },
        data: {
          status: outcome,
          reviewedAt: decidedAt,
          // The admin's id. The audit event is the authoritative record of
          // who; this is the copy the queue and the customer's own state read.
          reviewedBy: session.admin.id,
          rejectionReason: outcome === "REJECTED" ? reason : null,
        },
      });
      if (changed.count !== 1) {
        // Somebody decided it between the read above and this write.
        throw AppError.conflict("This submission was decided by someone else a moment ago.");
      }

      await tx.user.update({
        where: { id: existing.userId },
        data: { kycStatus: outcome },
      });

      await this.audit.record(
        {
          action: outcome === "APPROVED" ? "kyc.approved" : "kyc.rejected",
          actor: { id: session.admin.id, email: session.admin.email },
          subject: { type: SUBJECT, id: submissionId },
          reason,
          before: { submissionStatus: "PENDING" },
          after: { submissionStatus: outcome, userId: existing.userId },
          correlationId: context.correlationId,
          ip: context.ip ?? null,
        },
        tx,
      );

      // Same transaction as the decision itself: a customer must never be
      // told about a decision that did not happen, and a decision must never
      // happen with nobody told.
      await this.notifications.notify(
        outcome === "APPROVED"
          ? {
              userId: existing.userId,
              type: "KYC_APPROVED",
              title: "You're verified",
              body: "Your identity was approved. Your limits are lifted and you can post your own offers.",
              link: "/verify",
            }
          : {
              userId: existing.userId,
              type: "KYC_REJECTED",
              title: "Verification could not be completed",
              body: reason ?? "Check your details against your document and try again.",
              link: "/verify",
            },
        tx,
      );
    });

    this.logger.info(
      { event: "kyc.decided", outcome, submissionId, adminId: session.admin.id },
      "kyc submission decided",
    );

    const row = await this.prisma.client.kycSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      include: {
        user: { select: { id: true, platformId: true, username: true, email: true } },
        documents: { select: { id: true, kind: true }, orderBy: { kind: "asc" } },
      },
    });
    return toReviewItem(row);
  }
}

interface Row {
  id: string;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
  legalName: string;
  dateOfBirth: Date;
  country: string;
  documentType: string;
  documentNumber: string;
  user: { id: string; platformId: string; username: string; email: string };
  documents: { id: string; kind: string }[];
}

function toReviewItem(row: Row): KycReviewItem {
  return {
    id: row.id,
    status: row.status as KycReviewItem["status"],
    submittedAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    account: {
      userId: row.user.id,
      platformId: row.user.platformId,
      username: row.user.username,
      email: row.user.email,
    },
    legalName: row.legalName,
    // A plain calendar date, as it was stored.
    dateOfBirth: row.dateOfBirth.toISOString().slice(0, 10),
    country: row.country,
    documentType: row.documentType as KycDocumentType,
    documentNumber: row.documentNumber,
    documents: row.documents.map((document) => ({
      id: document.id,
      kind: document.kind as KycDocumentKind,
    })),
  };
}
