import { createPrismaClient, type Prisma, type PrismaClient } from "@abay/database";
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { withTransactionScope } from "@/common/io/transaction-scope";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";

/*
  Owns the one PrismaClient for the process. It connects before the server
  listens (see onModuleInit) and disconnects when the application closes, so
  a graceful shutdown lets in-flight queries finish before the pool goes away.

  The client is exposed as a property rather than by inheritance so that the
  ledger module can later wrap it (interactive transactions, row locks)
  without fighting Prisma's own method surface.
*/
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(
    @Inject(ENV) env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PrismaService.name);
    this.client = createPrismaClient(
      env.DATABASE_URL,
      env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    );
  }

  /*
    Connected before the server listens, not by the first request. Left to
    itself Prisma connects lazily, and the first query pays for starting the
    engine and opening the pool: about four seconds, measured on a restart.
    After a deploy that first query belongs to whoever arrives first, which is
    every tab the restart let go, all coming back for their socket - and each
    of them waited those seconds with "Reconnecting" on the screen.

    A database that is not there yet is no reason to refuse to start: the
    readiness probe says so, and the first query connects as it always did.
  */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.$connect();
      await this.client.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.warn(
        { event: "prisma.warmup_failed", err: error },
        "could not reach the database at startup; the first query will try again",
      );
    }
  }

  /*
    An interactive transaction that the rest of the process can see.

    Every transaction that touches money should open through here rather than
    through client.$transaction directly: the scope it enters is what lets an
    outbound HTTP or storage call refuse to run while the row locks are held
    (AT-19, common/io/transaction-scope.ts), and what carries the work that
    waits for the commit (afterCommit). The name is for the error message
    that call would raise, and for nothing else.

    The timeouts are longer than Prisma's defaults on purpose. A posting that
    is queued behind another on the same balance row is waiting correctly, not
    hanging, and the default five seconds would turn a busy account into
    failed requests under exactly the load the row lock exists to serialise.
  */
  transaction<T>(
    name: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options: { maxWait?: number; timeout?: number } = {},
  ): Promise<T> {
    return withTransactionScope(
      name,
      () =>
        this.client.$transaction(work, {
          maxWait: options.maxWait ?? 10_000,
          timeout: options.timeout ?? 30_000,
        }),
      (error) => {
        this.logger.warn(
          { event: "transaction.after_commit_failed", transaction: name, err: error },
          "work scheduled for after a commit failed; the commit itself stands",
        );
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    // A disconnect can reject if a connection attempt is still failing at the
    // moment of shutdown. Nothing useful can be done with that at this point.
    await this.client.$disconnect().catch(() => undefined);
  }
}
