import { createPrismaClient, type PrismaClient } from "@abay/database";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";

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

  async onModuleDestroy(): Promise<void> {
    // A disconnect can reject if a connection attempt is still failing at the
    // moment of shutdown. Nothing useful can be done with that at this point.
    await this.client.$disconnect().catch(() => undefined);
  }
}
