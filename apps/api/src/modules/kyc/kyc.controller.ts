import {
  kycDocumentKind,
  kycSubmissionRequest,
  type KycDocumentKind,
  type KycDocumentResponse,
  type KycStateResponse,
  type KycSubmissionRequest,
} from "@abay/contracts";
import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from "@nestjs/common";
import { type FastifyReply } from "fastify";
import { z } from "zod";

import { AppError } from "@/common/errors/app-error";
import {
  RateLimit,
  hours,
  minutes,
  perIp,
  perSession,
} from "@/common/rate-limit/rate-limit.policy";
import { ZodValidationPipe, zodBody } from "@/common/validation/zod-validation.pipe";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { type AuthenticatedSession } from "@/modules/auth/session.service";
import { KycService } from "@/modules/kyc/kyc.service";

/** "front", "back" or "selfie" in the path; the enum itself is upper case. */
const kindParam = z.string().trim().toUpperCase().pipe(kycDocumentKind);

const documentIdParam = z.uuid();

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
  /*
    The most expensive thing a customer can ask of this API: ten megabytes a
    time, straight into object storage, which is billed by what is kept
    (threat model B5.4, B1.7). Thirty an hour covers three photographs taken
    several times over and a form abandoned and started again; it does not
    cover using the bucket as free storage. The per-IP limit sits above it so
    that one machine cannot do the same through a handful of accounts.
  */
  @RateLimit(perSession(30, hours(1)), perIp(60, hours(1)))
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

  /*
    The bytes back, so a form picked up again can show the photographs already
    uploaded. Streamed through the API rather than handed out as a signed URL
    from the store: the credentials stay in this process, the session is
    checked on every read, and the global no-store header keeps an identity
    document out of the browser's disk cache.
  */
  @Get("documents/:id")
  // Reads bytes back out of the store on every call, so it is metered too,
  // loosely: a form being filled in fetches a few previews at a time.
  @RateLimit(perSession(120, minutes(5)))
  async document(
    @Param("id", new ZodValidationPipe(documentIdParam)) id: string,
    @CurrentSession() session: AuthenticatedSession,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const found = await this.kyc.readDocument(session.user.id, id);
    if (!found) throw AppError.notFound("That photo is no longer available.");
    await reply.type(found.contentType).send(found.body);
  }

  /** 202: accepted for review, not decided. The answer comes from a person. */
  @Post()
  @HttpCode(202)
  @RateLimit(perSession(10, hours(1)))
  submit(
    @Body(zodBody(kycSubmissionRequest)) body: KycSubmissionRequest,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<KycStateResponse> {
    return this.kyc.submit(session.user.id, body);
  }
}
