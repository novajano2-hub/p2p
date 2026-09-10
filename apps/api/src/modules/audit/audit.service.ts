import { type Prisma } from "@abay/database";
import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { PrismaService } from "@/infra/prisma/prisma.service";

/*
  Who did what, to what, and why.

  This is the answer to "an administrator denies having acted" (threat model
  B7.4), which means two things about how it is written. It is append-only,
  enforced by a database trigger rather than by everyone remembering; and it is
  written inside the same transaction as the thing it describes, so there is no
  window in which a decision exists without a record of who made it.

  It is not a log. Logs are for operators and roll away; this is evidence, it
  outlives the rows it points at, and it is queried by subject.
*/

/** A Prisma client or an open transaction. Callers pass the transaction. */
type Writer = Pick<Prisma.TransactionClient, "auditEvent">;

export interface AuditActor {
  id: string;
  email: string;
}

export interface AuditRecord {
  /** Dotted, past tense: "kyc.approved". */
  action: string;
  /** Null for something the system decided on its own. */
  actor: AuditActor | null;
  subject: { type: string; id: string };
  /** Mandatory for a decision. The service that owns the decision enforces that. */
  reason?: string | null;
  before?: Prisma.InputJsonValue | undefined;
  after?: Prisma.InputJsonValue | undefined;
  correlationId: string;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuditService.name);
  }

  /**
   * Writes one event. Pass the transaction when the event belongs to a change
   * being made in one: the two commit together or neither does.
   */
  async record(event: AuditRecord, tx?: Writer): Promise<void> {
    const writer = tx ?? this.prisma.client;
    await writer.auditEvent.create({
      data: {
        action: event.action,
        actorAdminId: event.actor?.id ?? null,
        // Copied down rather than joined: the audit has to still name the
        // person after the account is gone.
        actorEmail: event.actor?.email ?? null,
        subjectType: event.subject.type,
        subjectId: event.subject.id,
        reason: event.reason ?? null,
        ...(event.before === undefined ? {} : { before: event.before }),
        ...(event.after === undefined ? {} : { after: event.after }),
        correlationId: event.correlationId,
        ip: event.ip ?? null,
      },
    });

    // Also to the log, where an operator watching a live incident is looking.
    // The row is the record; this is only the shout.
    this.logger.info(
      {
        event: "audit",
        action: event.action,
        actorAdminId: event.actor?.id,
        subject: `${event.subject.type}:${event.subject.id}`,
        correlationId: event.correlationId,
      },
      "admin action recorded",
    );
  }
}
