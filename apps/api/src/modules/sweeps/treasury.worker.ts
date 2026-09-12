import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { RedisService } from "@/infra/redis/redis.service";
import { ReconcilerService } from "@/modules/reconciliation/reconciler.service";
import { SweepService } from "@/modules/sweeps/sweep.service";

/*
  Treasury housekeeping, on a slower timer than the money paths: sweep what
  has piled up at deposit addresses, settle the sweeps that have confirmed,
  then hold the chain up against the ledger.

  Slower on purpose. Sweeping costs gas, so batching is the point; and a
  reconciliation pass asks the chain about every address we have, which is
  the most expensive read in the system. Neither is urgent - a customer is
  never waiting on either - and both are ruinous to run in a tight loop.
*/

const INTERVAL_MS = 60_000;
const LOCK_KEY = "treasury:housekeeping";
const LOCK_TTL_MS = 5 * 60_000;

@Injectable()
export class TreasuryWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly redis: RedisService,
    private readonly sweeps: SweepService,
    private readonly reconciler: ReconcilerService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TreasuryWorker.name);
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const acquired = await this.redis.client.set(LOCK_KEY, "1", "PX", LOCK_TTL_MS, "NX");
      if (acquired !== "OK") return;
      const swept = await this.sweeps.sweepDue();
      const settled = await this.sweeps.confirmSweeps();
      const report = await this.reconciler.reconcile();
      if (swept.swept + swept.failed + settled.confirmed > 0 || !report.agrees) {
        this.logger.info(
          { event: "treasury.pass", ...swept, ...settled, breaksOpen: report.breaksOpen },
          "treasury housekeeping pass",
        );
      }
    } catch (error) {
      this.logger.warn(
        { event: "treasury.pass_failed", err: error },
        "the treasury pass did not run",
      );
    } finally {
      this.running = false;
    }
  }
}
