import { type DepositsResponse, type DepositView } from "@abay/contracts";
import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { ZodValidationPipe } from "@/common/validation/zod-validation.pipe";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { type AuthenticatedSession } from "@/modules/auth/session.service";
import { DepositService } from "@/modules/deposits/deposit.service";

const idParam = z.uuid();

/** A customer's own deposits: where each one is, and how many confirmations it has. */
@Controller("wallet/deposits")
@UseGuards(SessionGuard)
export class DepositsController {
  constructor(private readonly deposits: DepositService) {}

  @Get()
  async list(@CurrentSession() session: AuthenticatedSession): Promise<DepositsResponse> {
    return { deposits: await this.deposits.listForUser(session.user.id) };
  }

  @Get(":id")
  get(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<DepositView> {
    return this.deposits.getForUser(session.user.id, id);
  }
}
