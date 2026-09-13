import {
  adminCustomerSearchQuery,
  type AdminCustomerSearchQuery,
  type AdminCustomerSearchResponse,
} from "@abay/contracts";
import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { type FastifyRequest } from "fastify";

import { RateLimit, minutes, perSession } from "@/common/rate-limit/rate-limit.policy";
import { zodQuery } from "@/common/validation/zod-validation.pipe";
import { type AdminSessionContext } from "@/modules/admin/admin-session.service";
import { AdminGuard, CurrentAdmin, RequireAdminRole } from "@/modules/admin/admin.guard";
import { AuditService } from "@/modules/audit/audit.service";
import { CustomerDirectoryService } from "@/modules/customers/customer-directory.service";

/*
  Finding a customer by account number, username or email.

  This exists because attributing a stray deposit asks "whose is this?", and
  the answer a person has is an account number on a support ticket, not a
  uuid. Open to the three roles that already decide things about named
  customers; every search is recorded, because being able to look up any
  customer by name is exactly the power that should leave a trail.
*/

@Controller("admin/customers")
@UseGuards(AdminGuard)
@RequireAdminRole("DEPOSIT_REVIEWER", "WITHDRAWAL_APPROVER", "KYC_REVIEWER")
export class AdminCustomersController {
  constructor(
    private readonly customers: CustomerDirectoryService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  // Generous enough to type, tight enough that nobody enumerates the
  // customer base one two-letter prefix at a time.
  @RateLimit(perSession(120, minutes(5)))
  async search(
    @Query(zodQuery(adminCustomerSearchQuery)) query: AdminCustomerSearchQuery,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<AdminCustomerSearchResponse> {
    const result = await this.customers.search(query.q);
    await this.audit.record({
      action: "customer.searched",
      actor: { id: session.admin.id, email: session.admin.email },
      // The search itself is the subject: there is no one row this was about,
      // and the term is the thing worth keeping.
      subject: { type: "customer_search", id: session.admin.id },
      after: { term: query.q, matched: result.customers.length },
      correlationId: request.id,
      ip: request.ip,
    });
    return result;
  }
}
