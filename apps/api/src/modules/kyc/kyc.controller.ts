import {
  kycSubmissionRequest,
  type KycStateResponse,
  type KycSubmissionRequest,
} from "@abay/contracts";
import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";

import { zodBody } from "@/common/validation/zod-validation.pipe";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { type AuthenticatedSession } from "@/modules/auth/session.service";
import { KycService } from "@/modules/kyc/kyc.service";

/*
  Both routes are the customer's own: the session decides whose verification
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
