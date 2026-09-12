import {
  ledgerAccountsQuery,
  ledgerStatementQuery,
  ledgerTransactionsQuery,
  type LedgerAccountDetail,
  type LedgerAccountsFilter,
  type LedgerAccountsResponse,
  type LedgerOverview,
  type LedgerStatementFilter,
  type LedgerStatementRow,
  type LedgerTransactionDetail,
  type LedgerTransactionsFilter,
  type LedgerTransactionsResponse,
} from "@abay/contracts";
import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { type FastifyRequest } from "fastify";
import { z } from "zod";

import { RateLimit, minutes, perSession } from "@/common/rate-limit/rate-limit.policy";
import { ZodValidationPipe, zodQuery } from "@/common/validation/zod-validation.pipe";
import { AdminLedgerService } from "@/modules/admin/admin-ledger.service";
import { type AdminSessionContext } from "@/modules/admin/admin-session.service";
import { AdminGuard, CurrentAdmin, RequireAdminRole } from "@/modules/admin/admin.guard";

/*
  The ledger, read-only, for an administrator holding LEDGER_VIEWER.

  Every route is a GET and there is no other kind here: nothing under this
  prefix can post, correct, or "set" a balance, and a future route that could
  would need a different role and a different file. The role is its own
  because reading a person's balance is a capability in its own right - an
  auditor should not have to be able to move money in order to look.
*/

const idParam = z.uuid();

const requestContext = (request: FastifyRequest) => ({
  correlationId: request.id,
  ip: request.ip,
});

@Controller("admin/ledger")
@UseGuards(AdminGuard)
@RequireAdminRole("LEDGER_VIEWER")
// A person reading a ledger pages through it; a script walks it. The same
// figures as the KYC routes, for the same reason.
@RateLimit(perSession(300, minutes(5)))
export class AdminLedgerController {
  constructor(private readonly ledger: AdminLedgerService) {}

  /** Is the ledger consistent right now, and what does it hold. Aggregates only. */
  @Get("overview")
  overview(): Promise<LedgerOverview> {
    return this.ledger.overview();
  }

  @Get("accounts")
  accounts(
    @Query(zodQuery(ledgerAccountsQuery)) query: LedgerAccountsFilter,
  ): Promise<LedgerAccountsResponse> {
    return this.ledger.accounts(query);
  }

  /** One account with its balance and the first page of its statement. Recorded. */
  @Get("accounts/:id")
  account(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<LedgerAccountDetail> {
    return this.ledger.account(id, session, requestContext(request));
  }

  /** Further pages of the statement, newest first. */
  @Get("accounts/:id/statement")
  statement(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @Query(zodQuery(ledgerStatementQuery)) query: LedgerStatementFilter,
  ): Promise<{ statement: LedgerStatementRow[]; nextCursor: string | null }> {
    return this.ledger.statement(id, query);
  }

  @Get("transactions")
  transactions(
    @Query(zodQuery(ledgerTransactionsQuery)) query: LedgerTransactionsFilter,
  ): Promise<LedgerTransactionsResponse> {
    return this.ledger.transactions(query);
  }

  /** One transaction in full, with its reversal links. Recorded when it touched somebody's account. */
  @Get("transactions/:id")
  transaction(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentAdmin() session: AdminSessionContext,
    @Req() request: FastifyRequest,
  ): Promise<LedgerTransactionDetail> {
    return this.ledger.transaction(id, session, requestContext(request));
  }
}
