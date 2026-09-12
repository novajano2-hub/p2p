import { createPrismaClient, type Prisma, type PrismaClient } from "@abay/database";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";

import { withTransactionScope } from "@/common/io/transaction-scope";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";

/*
  Owns the one PrismaClient for the process. It connects lazily on first use
  and disconnects when the application closes, so a graceful shutdown lets
  in-flight queries finish before the pool goes away.

  The client is exposed as a property rather than by inheritance so that the
  ledger module can later wrap it (interactive transactions, row locks)
  without fighting Prisma's own method surface.
*/
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(ENV) env: Env) {
    this.client = createPrismaClient(
      env.DATABASE_URL,
      env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    );
  }

  /*
    An interactive transaction that the rest of the process can see.

    Every transaction that touches money should open through here rather than
    through client.$transaction directly: the scope it enters is what lets an
    outbound HTTP or storage call refuse to run while the row locks are held
    (AT-19, common/io/transaction-scope.ts). The name is for the error message
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
    return withTransactionScope(name, () =>
      this.client.$transaction(work, {
        maxWait: options.maxWait ?? 10_000,
        timeout: options.timeout ?? 30_000,
      }),
    );
  }

  async onModuleDestroy(): Promise<void> {
    // A disconnect can reject if a connection attempt is still failing at the
    // moment of shutdown. Nothing useful can be done with that at this point.
    await this.client.$disconnect().catch(() => undefined);
  }
}
