import {
  kycDocumentKind,
  kycSubmissionRequest,
  type KycDocumentKind,
  type KycDocumentResponse,
  type KycStateResponse,
  type KycSubmissionRequest,
} from "@abay/contracts";
import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AppError } from "@/common/errors/app-error";
import { ZodValidationPipe, zodBody } from "@/common/validation/zod-validation.pipe";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { type AuthenticatedSession } from "@/modules/auth/session.service";
import { KycService } from "@/modules/kyc/kyc.service";

/** "front", "back" or "selfie" in the path; the enum itself is upper case. */
const kindParam = z.string().trim().toUpperCase().pipe(kycDocumentKind);

/*
  Every route is the customer's own: the session decides whose verification
  is read or written, never a parameter. There is no route here that approves
  anything - that is the administrator's, and lives in the admin realm.
*/
@Controller("kyc")
@UseGuards(SessionGuard)
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Get()
  state(@CurrentSession() session: AuthenticatedSession): Promise<KycStateResponse> {
    return this.kyc.state(session.user.id);
  }

  /*
    One photograph per request, sent as the raw image under its own content
    type (image/jpeg, image/png or image/webp; createApp registers the parsers
    and the size limit). 201: kept, staged, waiting for a submission to name it.
  */
  @Post("documents/:kind")
  @HttpCode(201)
  upload(
    @Param("kind", new ZodValidationPipe(kindParam)) kind: KycDocumentKind,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<KycDocumentResponse> {
    if (!Buffer.isBuffer(body)) {
      // JSON, a form, or nothing at all: none of those is a photograph.
      throw AppError.validation(
        [{ path: "file", message: "Send the photo itself as the request body." }],
        "Upload the photo as a JPEG, PNG or WebP image.",
      );
    }
    return this.kyc.uploadDocument(session.user.id, kind, body);
  }

  /** 202: accepted for review, not decided. The answer comes from a person. */
  @Post()
  @HttpCode(202)
  submit(
    @Body(zodBody(kycSubmissionRequest)) body: KycSubmissionRequest,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<KycStateResponse> {
    return this.kyc.submit(session.user.id, body);
  }
}
