import { type Prisma } from "@abay/database";
import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { assertNoOpenTransaction } from "@/common/io/transaction-scope";
import { PrismaService } from "@/infra/prisma/prisma.service";

/*
  The transactional outbox (ADR-0007).

  An external effect - an email, a notification, an event for another system
  - is a row written in the same transaction as the change that caused it,
  so the two commit together or neither does. Nothing is sent from inside a
  request handler, and nothing is sent from inside a transaction: the worker
  claims rows and delivers them afterwards, on its own time.

  Delivery is at-least-once. A worker that dies between delivering and
  recording the delivery will deliver again when its lease expires, so every
  handler is written to be safe to run twice. What the outbox promises is
  the other direction: nothing that committed is ever lost, and nothing that
  rolled back is ever sent.
*/

export interface OutboxContext {
  id: string;
  correlationId: string;
  attempt: number;
}

export type OutboxHandler = (payload: unknown, context: OutboxContext) => Promise<void>;

/** A claim lasts this long; a worker that dies loses it and the row is retried. */
const LEASE_SECONDS = 120;
/** After this many attempts the row is FAILED and waits for a person. */
export const MAX_ATTEMPTS = 10;

/** 30s, 1m, 2m, 4m ... capped at an hour. Called with the attempt that just failed. */
export const backoffSeconds = (attempt: number): number =>
  Math.min(30 * 2 ** Math.max(0, attempt - 1), 3_600);

interface Claimed {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  correlation_id: string;
}

@Injectable()
export class OutboxService {
  private readonly handlers = new Map<string, OutboxHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutboxService.name);
  }

  /** In the caller's transaction, always. Returns the event id. */
  async enqueue(
    tx: Pick<Prisma.TransactionClient, "outboxEvent">,
    event: {
      type: string;
      payload: Prisma.InputJsonValue;
      correlationId: string;
      availableAt?: Date | undefined;
    },
  ): Promise<string> {
    const row = await tx.outboxEvent.create({
      data: {
        type: event.type,
        payload: event.payload,
        correlationId: event.correlationId,
        ...(event.availableAt ? { availableAt: event.availableAt } : {}),
      },
      select: { id: true },
    });
    return row.id;
  }

  /** One handler per type. Registering a type twice is a wiring bug and says so. */
  register(type: string, handler: OutboxHandler): void {
    if (this.handlers.has(type))
      throw new Error(`outbox: a handler for ${type} is already registered`);
    this.handlers.set(type, handler);
  }

  /*
    One pass. The claim is a single statement - select with SKIP LOCKED,
    then update - so two workers never take the same row, and taking it
    advances available_at by the lease so a crashed worker's rows come back
    on their own. Delivery happens after that statement commits, outside
    any transaction, because that is where network I/O belongs (AT-19).
  */
  async drain(limit = 20): Promise<{ attempted: number; sent: number; failed: number }> {
    assertNoOpenTransaction("delivering outbox events");
    const claimed = await this.prisma.client.$queryRaw<Claimed[]>`
      WITH picked AS (
        SELECT id FROM outbox_events
         WHERE status = 'PENDING' AND available_at <= now()
         ORDER BY available_at
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_events e
         SET attempts = e.attempts + 1,
             available_at = now() + make_interval(secs => ${LEASE_SECONDS})
        FROM picked
       WHERE e.id = picked.id
      RETURNING e.id, e.type, e.payload, e.attempts, e.correlation_id`;

    let sent = 0;
    let failed = 0;
    for (const row of claimed) {
      const handler = this.handlers.get(row.type);
      try {
        if (!handler) throw new Error(`no handler registered for ${row.type}`);
        await handler(row.payload, {
          id: row.id,
          correlationId: row.correlation_id,
          attempt: row.attempts,
        });
        await this.prisma.client.outboxEvent.update({
          where: { id: row.id },
          data: { status: "SENT", sentAt: new Date(), lastError: null },
        });
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const exhausted = row.attempts >= MAX_ATTEMPTS;
        await this.prisma.client.outboxEvent.update({
          where: { id: row.id },
          data: exhausted
            ? { status: "FAILED", lastError: message }
            : {
                lastError: message,
                availableAt: new Date(Date.now() + backoffSeconds(row.attempts) * 1_000),
              },
        });
        if (exhausted) failed += 1;
        this.logger.warn(
          {
            event: exhausted ? "outbox.failed" : "outbox.retry",
            outboxId: row.id,
            type: row.type,
            attempt: row.attempts,
            correlationId: row.correlation_id,
            reason: message,
          },
          exhausted ? "outbox event gave up" : "outbox event will be retried",
        );
      }
    }
    return { attempted: claimed.length, sent, failed };
  }
}
