import {
  resolveBreakRequest,
  type ReconciliationBreaksResponse,
  type ReconciliationBreakView,
  type ReconciliationReport,
  type ResolveBreakRequest,
  type SweepsResponse,
} from "@abay/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { type FastifyRequest } from "fastify";
import { z } from "zod";

import { RateLimit, minutes, perSession } from "@/common/rate-limit/rate-limit.policy";
import { ZodValidationPipe, zodBody, zodQuery } from "@/common/validation/zod-validation.pipe";
import { type AdminSessionContext } from "@/modules/admin/admin-session.service";
import { AdminGuard, CurrentAdmin, RequireAdminRole } from "@/modules/admin/admin.guard";
import { AdjustmentService } from "@/modules/reconciliation/adjustment.service";
import { ReconcilerService } from "@/modules/reconciliation/reconciler.service";
import { SweepService } from "@/modules/sweeps/sweep.service";

/*
  Where the chain and the ledger are held up against each other.

  Reading this is LEDGER_VIEWER's: it is the same class of question as
  reading the ledger, and an auditor should be able to ask it. Resolving a
  break is FINANCIAL_ADJUSTER's, and it is a different capability on purpose
  - one is looking, the other is posting an entry that moves the platform's
  own money (ADR-0009).
*/

const idParam = z.uuid();

const breaksQuery = z.object({ status: z.enum(["OPEN", "RESOLVED", "DISMISSED"]).optional() });

const requestContext = (request: FastifyRequest) => ({
  correlationId: request.id,
  ip: request.ip,
});

@Controller("admin/reconciliation")
@UseGuards(AdminGuard)
export class AdminReconciliationController {
  constructor(
    private readonly reconciler: ReconcilerService,
    private readonly adjustments: AdjustmentService,
    private readonly sweeps: SweepService,
  ) {}

  /** Runs a pass now and returns what it saw. Reads only; posts nothing. */
  @Get("report")
  @RequireAdminRole("LEDGER_VIEWER")
  // A pass asks the chain about every address we have, so it is not free.
  @RateLimit(perSession(30, minutes(5)))
  report(@Req() request: FastifyRequest): Promise<ReconciliationReport> {
    return this.reconciler.reconcile(request.id);
  }

  @Get("breaks")
  @RequireAdminRole("LEDGER_VIEWER")
  breaks(
    @Query(zodQuery(breaksQuery)) query: { status?: "OPEN" | "RESOLVED" | "DISMISSED" },
  ): Promise<ReconciliationBreaksResponse> {
    return this.reconciler.breaks(query.status);
  }

  @Get("breaks/:id")
  @RequireAdminRole("LEDGER_VIEWER")
  one(@Param("id", new ZodValidationPipe(idParam)) id: string): Promise<ReconciliationBreakView> {
    return this.reconciler.getBreak(id);
  }

  /** The adjustment workflow: the only path from a break to a ledger entry. */
  @Post("breaks/:id/resolve")
  @HttpCode(200)
  @RequireAdminRole("FINANCIAL_ADJUSTER")
  @RateLimit(perSession(30, minutes(5)))
  resolve(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Body(zodBody(resolveBreakRequest)) body: ResolveBreakRequest,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<ReconciliationBreakView> {
    return this.adjustments.resolve(id, body, session, requestContext(request));
  }

  /** Treasury housekeeping, for the same readers. */
  @Get("sweeps")
  @RequireAdminRole("LEDGER_VIEWER")
  async sweepList(): Promise<SweepsResponse> {
    const [sweeps, unswept] = await Promise.all([this.sweeps.list(), this.sweeps.unswept()]);
    return { sweeps, unswept: unswept.toString() };
  }
}
