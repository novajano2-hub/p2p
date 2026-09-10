import { type KycStateResponse, type KycSubmissionRequest } from "@abay/contracts";
import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { AppError } from "@/common/errors/app-error";
import { PrismaService } from "@/infra/prisma/prisma.service";

/*
  Identity verification, from the customer's side. The administrator's side -
  the queue, the decision, the record of who decided - belongs to the admin
  realm (Phase 1 step 3) and is deliberately not reachable from here: nothing
  a customer's session can call may approve a customer.
*/
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(KycService.name);
  }

  /** Where this account stands, and why, if it was refused. */
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

    return {
      status: user.kycStatus,
      submittedAt: latest?.createdAt.toISOString() ?? null,
      reviewedAt: latest?.reviewedAt?.toISOString() ?? null,
      // Only meaningful while the account is actually refused: a reason left
      // over from an earlier attempt would contradict the current status.
      rejectionReason: user.kycStatus === "REJECTED" ? (latest?.rejectionReason ?? null) : null,
    };
  }

  /*
    Records an attempt and puts the account in the review queue.

    Allowed from NOT_STARTED and from REJECTED, so a refusal can be corrected.
    Refused while PENDING, because a second submission leaves an administrator
    with two versions of the truth and no way to tell which one the customer
    meant; and while APPROVED, because changing the identity behind a verified
    account is a support decision, not a self-service one.
  */
  async submit(userId: string, input: KycSubmissionRequest): Promise<KycStateResponse> {
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

    await this.prisma.client.$transaction(async (tx) => {
      await tx.kycSubmission.create({
        data: {
          userId,
          legalName: input.legalName,
          // A plain calendar date, parsed as UTC midnight so it stays the same
          // day whatever zone the server runs in.
          dateOfBirth: new Date(input.dateOfBirth + "T00:00:00Z"),
          country: input.country,
          documentType: input.documentType,
          documentNumber: input.documentNumber,
        },
      });
      await tx.user.update({ where: { id: userId }, data: { kycStatus: "PENDING" } });
    });

    // The details themselves are never logged: this says an event happened,
    // not who anyone is.
    this.logger.info({ event: "kyc.submitted", userId }, "kyc submission received");

    return this.state(userId);
  }
}
