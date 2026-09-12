import { type ReconciliationBreakView, type ResolveBreakRequest } from "@abay/contracts";
import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { AppError } from "@/common/errors/app-error";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { type AdminSessionContext } from "@/modules/admin/admin-session.service";
import { AuditService } from "@/modules/audit/audit.service";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { toBreakView } from "@/modules/reconciliation/reconciler.service";

/*
  The adjustment workflow: the only way a reconciliation break is ever
  answered with a ledger entry, and it is a person doing it, with a reason,
  under the FINANCIAL_ADJUSTER role (ADR-0009, threat model B7.1).

  Two entries, and which one applies is a judgement about the world rather
  than about arithmetic:

    JE-11  a surplus, booked to RECONCILIATION_SUSPENSE. Coins we did not
           expect are recorded as something we may owe somebody, never as
           revenue - somebody probably sent them, and finding out who is a
           separate job from admitting we have them.

    JE-12  a shortfall, written off to LOSSES. Customer liabilities are
           untouched: a platform loss is absorbed by the platform's equity,
           not by quietly reducing the balances of people who did nothing
           wrong. This is the entry that should be hardest to post.

  A third answer, DISMISS, posts nothing: for a break that turned out to be
  explained by something the reconciler could not see.
*/

const SUBJECT = "reconciliation_break";

@Injectable()
export class AdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdjustmentService.name);
  }

  async resolve(
    id: string,
    input: ResolveBreakRequest,
    session: AdminSessionContext,
    context: { correlationId: string; ip?: string | undefined },
  ): Promise<ReconciliationBreakView> {
    const found = await this.prisma.client.reconciliationBreak.findUnique({ where: { id } });
    if (!found) throw AppError.notFound("There is no such reconciliation break.");
    if (found.status !== "OPEN") {
      throw AppError.conflict(`This break was already ${found.status.toLowerCase()}.`);
    }
    // The action has to match the direction: writing off a surplus or
    // booking a shortfall as owed would both create money out of a typo.
    if (input.action === "RECORD_SURPLUS" && found.kind !== "SURPLUS") {
      throw AppError.conflict("This break is a shortfall, not a surplus.");
    }
    if (input.action === "WRITE_OFF_SHORTFALL" && found.kind !== "SHORTFALL") {
      throw AppError.conflict("This break is a surplus, not a shortfall.");
    }

    await this.prisma.transaction("reconciliation:resolve", async (tx) => {
      const locked = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM reconciliation_breaks WHERE id = ${id} FOR UPDATE`;
      if (locked[0]?.status !== "OPEN") {
        throw AppError.conflict("This break was resolved by someone else a moment ago.");
      }

      let adjustmentTransactionId: string | null = null;
      if (input.action !== "DISMISS") {
        const surplus = input.action === "RECORD_SURPLUS";
        const posted = await this.ledger.postIn(tx, {
          reason: surplus
            ? "RECONCILIATION_SURPLUS_RECORDED"
            : "RECONCILIATION_SHORTFALL_WRITTEN_OFF",
          asset: "USDT",
          reference: { type: SUBJECT, id },
          actor: { type: "ADMIN", id: session.admin.id },
          correlationId: context.correlationId,
          idempotencyKey: `reconciliation:${id}:adjust`,
          lines: surplus
            ? [
                { account: found.accountCode, direction: "DEBIT", amount: found.difference },
                {
                  account: accounts.platform("RECONCILIATION_SUSPENSE"),
                  direction: "CREDIT",
                  amount: found.difference,
                },
              ]
            : [
                {
                  account: accounts.platform("LOSSES"),
                  direction: "DEBIT",
                  amount: found.difference,
                },
                { account: found.accountCode, direction: "CREDIT", amount: found.difference },
              ],
        });
        adjustmentTransactionId = posted.id;
      }

      await tx.reconciliationBreak.update({
        where: { id },
        data: {
          status: input.action === "DISMISS" ? "DISMISSED" : "RESOLVED",
          resolvedBy: session.admin.id,
          resolvedAt: new Date(),
          resolutionReason: input.reason,
          adjustmentTransactionId,
        },
      });
      await this.audit.record(
        {
          action: `reconciliation.${input.action.toLowerCase()}`,
          actor: { id: session.admin.id, email: session.admin.email },
          subject: { type: SUBJECT, id },
          reason: input.reason,
          before: {
            status: "OPEN",
            kind: found.kind,
            accountCode: found.accountCode,
            difference: found.difference.toString(),
          },
          after: {
            status: input.action === "DISMISS" ? "DISMISSED" : "RESOLVED",
            adjustmentTransactionId,
          },
          correlationId: context.correlationId,
          ip: context.ip ?? null,
        },
        tx,
      );
      this.logger.warn(
        {
          event: "reconciliation.resolved",
          breakId: id,
          action: input.action,
          adminId: session.admin.id,
          difference: found.difference.toString(),
        },
        "a reconciliation break was resolved by hand",
      );
    });

    const updated = await this.prisma.client.reconciliationBreak.findUniqueOrThrow({
      where: { id },
    });
    return toBreakView(updated);
  }
}
