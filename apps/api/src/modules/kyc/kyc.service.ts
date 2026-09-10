import {
  ISSUING_COUNTRY,
  requiredDocumentKinds,
  type KycDocumentKind,
  type KycDocumentResponse,
  type KycImageType,
  type KycStateResponse,
  type KycSubmissionRequest,
} from "@abay/contracts";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { v7 as uuidv7 } from "uuid";

import { AppError } from "@/common/errors/app-error";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { OBJECT_STORE, StorageError, type ObjectStore } from "@/infra/storage/object-store";
import { IMAGE_EXTENSIONS, sniffImageType } from "@/modules/kyc/image-type";

/*
  Identity verification, from the customer's side. The administrator's side -
  the queue, the decision, the record of who decided - belongs to the admin
  realm (Phase 1 step 3) and is deliberately not reachable from here: nothing
  a customer's session can call may approve a customer.

  Two moves. The photographs go up first, one request each, and sit staged
  against the account; then the submission names them, and they become part
  of the record an administrator reads. Uploading as you go is what makes a
  retake cheap and a bad connection survivable, and it is why `state` reports
  what is staged: a customer who closed the tab comes back to their photos
  rather than to an empty form. What nobody comes back for, the sweep in
  kyc-retention.service.ts throws away.
*/
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(KycService.name);
  }

  /** Where this account stands, why it was refused, and what is already uploaded. */
  async state(userId: string): Promise<KycStateResponse> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { kycStatus: true },
    });
    if (!user) throw AppError.unauthenticated();

    const latest = await this.prisma.client.kycSubmission.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, reviewedAt: true, rejectionReason: true },
    });

    // Staged only. A photograph that belongs to a submission is evidence in
    // someone else's hands now, and there is nothing for the form to do with it.
    const staged = await this.prisma.client.kycDocument.findMany({
      where: { userId, submissionId: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, kind: true, contentType: true, sizeBytes: true },
    });

    return {
      status: user.kycStatus,
      submittedAt: latest?.createdAt.toISOString() ?? null,
      reviewedAt: latest?.reviewedAt?.toISOString() ?? null,
      // Only meaningful while the account is actually refused: a reason left
      // over from an earlier attempt would contradict the current status.
      rejectionReason: user.kycStatus === "REJECTED" ? (latest?.rejectionReason ?? null) : null,
      documents: staged.map((document) => ({
        id: document.id,
        kind: document.kind,
        // The column is a string; only uploadDocument writes it, and only ever
        // with a type it sniffed out of the bytes themselves.
        contentType: document.contentType as KycImageType,
        sizeBytes: document.sizeBytes,
      })),
    };
  }

  /*
    Keeps one photograph, staged, until a submission claims it.

    The bytes decide what the file is, not the request's header, and they go
    to the store before a row says they exist: a row pointing at nothing is
    worse than a file nobody points at. Taking the same photograph again
    replaces the staged one, so there is only ever one of each kind waiting.
  */
  async uploadDocument(
    userId: string,
    kind: KycDocumentKind,
    body: Buffer,
  ): Promise<KycDocumentResponse> {
    await this.assertMaySubmit(userId);

    const contentType = sniffImageType(body);
    if (!contentType) {
      throw AppError.validation(
        [{ path: "file", message: "That file is not a JPEG, PNG or WebP image." }],
        "Upload the photo as a JPEG, PNG or WebP image.",
      );
    }

    const id = uuidv7();
    const key = `kyc/${userId}/${id}.${IMAGE_EXTENSIONS[contentType]}`;
    try {
      await this.store.put({ key, body, contentType });
    } catch (error) {
      if (error instanceof StorageError) {
        // Already logged with the provider's detail by the store itself.
        throw AppError.notReady(
          "We could not save the photo right now. Please try again in a moment.",
        );
      }
      throw error;
    }

    const previous = await this.prisma.client.kycDocument.findMany({
      where: { userId, kind, submissionId: null },
      select: { id: true, storageKey: true },
    });
    await this.prisma.client.$transaction([
      this.prisma.client.kycDocument.deleteMany({
        where: { id: { in: previous.map((document) => document.id) } },
      }),
      this.prisma.client.kycDocument.create({
        data: { id, userId, kind, storageKey: key, contentType, sizeBytes: body.length },
      }),
    ]);
    await this.discard(previous.map((document) => document.storageKey));

    // Never the bytes, never the key with the person attached to it in the
    // same line as anything about them: this says a photo arrived, that is all.
    this.logger.info(
      { event: "kyc.document_uploaded", userId, kind, bytes: body.length },
      "kyc photograph received",
    );

    return { id, kind, contentType, sizeBytes: body.length };
  }

  /*
    Hands back one of this account's own photographs, so a form that was
    abandoned can show what is already uploaded.

    Ownership is part of the lookup rather than a check after it, so someone
    else's identifier and an identifier that never existed produce the same
    nothing, and the answer reveals neither. A row whose bytes are already
    gone answers the same way: the sweep got there first.
  */
  async readDocument(
    userId: string,
    documentId: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    const document = await this.prisma.client.kycDocument.findFirst({
      where: { id: documentId, userId },
      select: { storageKey: true, contentType: true },
    });
    if (!document) return null;

    let body: Buffer | null;
    try {
      body = await this.store.get(document.storageKey);
    } catch (error) {
      if (error instanceof StorageError) {
        throw AppError.notReady(
          "We could not load that photo right now. Please try again in a moment.",
        );
      }
      throw error;
    }
    if (!body) return null;
    return { body, contentType: document.contentType };
  }

  /*
    Records an attempt and puts the account in the review queue.

    Allowed from NOT_STARTED and from REJECTED, so a refusal can be corrected.
    Refused while PENDING, because a second submission leaves an administrator
    with two versions of the truth and no way to tell which one the customer
    meant; and while APPROVED, because changing the identity behind a verified
    account is a support decision, not a self-service one.

    The photographs named must be this account's own, still unclaimed, and of
    the kind the slot says. Anything else staged and not named is discarded:
    a back uploaded before the customer switched to a passport is not
    evidence of anything.
  */
  async submit(userId: string, input: KycSubmissionRequest): Promise<KycStateResponse> {
    await this.assertMaySubmit(userId);

    const staged = await this.prisma.client.kycDocument.findMany({
      where: { userId, submissionId: null },
      select: { id: true, kind: true, storageKey: true },
    });
    const named: Record<KycDocumentKind, string | undefined> = {
      FRONT: input.documents.front,
      BACK: input.documents.back,
      SELFIE: input.documents.selfie,
    };

    const attach: string[] = [];
    for (const kind of requiredDocumentKinds(input.documentType)) {
      const match = staged.find(
        (document) => document.id === named[kind] && document.kind === kind,
      );
      if (!match) {
        throw AppError.validation(
          [{ path: `documents.${kind.toLowerCase()}`, message: "Upload this photo again" }],
          "A photo is missing. Upload it again.",
        );
      }
      attach.push(match.id);
    }
    const leftovers = staged.filter((document) => !attach.includes(document.id));

    await this.prisma.client.$transaction(async (tx) => {
      const submission = await tx.kycSubmission.create({
        data: {
          userId,
          legalName: input.legalName,
          // A plain calendar date, parsed as UTC midnight so it stays the same
          // day whatever zone the server runs in.
          dateOfBirth: new Date(input.dateOfBirth + "T00:00:00Z"),
          country: ISSUING_COUNTRY,
          documentType: input.documentType,
          documentNumber: input.documentNumber,
        },
        select: { id: true },
      });
      await tx.kycDocument.updateMany({
        where: { id: { in: attach }, userId, submissionId: null },
        data: { submissionId: submission.id },
      });
      await tx.kycDocument.deleteMany({
        where: { id: { in: leftovers.map((document) => document.id) } },
      });
      await tx.user.update({ where: { id: userId }, data: { kycStatus: "PENDING" } });
    });
    await this.discard(leftovers.map((document) => document.storageKey));

    // The details themselves are never logged: this says an event happened,
    // not who anyone is.
    this.logger.info(
      { event: "kyc.submitted", userId, documentType: input.documentType, photos: attach.length },
      "kyc submission received",
    );

    return this.state(userId);
  }

  private async assertMaySubmit(userId: string): Promise<void> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { kycStatus: true },
    });
    if (!user) throw AppError.unauthenticated();

    if (user.kycStatus === "PENDING") {
      throw AppError.conflict("Your verification is already being reviewed.");
    }
    if (user.kycStatus === "APPROVED") {
      throw AppError.conflict("Your identity is already verified.");
    }
  }

  /** Best effort. The rows are already gone; a file that outlives its row is waste, not a hole. */
  private async discard(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.store.delete(key);
      } catch (error) {
        this.logger.warn(
          { event: "kyc.document_discard_failed", key, err: error },
          "a stale photograph was left in the store",
        );
      }
    }
  }
}
