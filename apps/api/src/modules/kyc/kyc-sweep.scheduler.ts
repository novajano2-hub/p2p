import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { RedisService } from "@/infra/redis/redis.service";
import { KycRetentionService } from "@/modules/kyc/kyc-retention.service";

/*
  Runs the staging-area sweep, in the worker, on a timer.

  A plain interval rather than a queue: this is the worker's first job and
  BullMQ arrives with the deposit and withdrawal processors in Phase 3. When
  it does, this becomes a repeatable job and the lock below goes away.

  The lock is what keeps two worker replicas from sweeping the same rows at
  once. It is never released explicitly, only allowed to expire: releasing it
  correctly means proving the holder still owns it, and the cost of getting
  that wrong is worse than the cost of a sweep being skipped for one period.
*/

const INTERVAL_MS = 60 * 60 * 1000;
const LOCK_KEY = "kyc:sweep";
/** Comfortably longer than a sweep, comfortably shorter than the interval. */
const LOCK_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class KycSweepScheduler implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly retention: KycRetentionService,
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(KycSweepScheduler.name);
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.run(), INTERVAL_MS);
    // Once at boot, so a restart is also a sweep and a fresh deployment does
    // not wait an hour to clear whatever the last one left.
    void this.run();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async run(): Promise<void> {
    try {
      const acquired = await this.redis.client.set(LOCK_KEY, "1", "PX", LOCK_TTL_MS, "NX");
      if (acquired !== "OK") return;
      await this.retention.sweepAbandoned();
    } catch (error) {
      // Redis down, database down: the sweep is not urgent enough to be loud
      // about, and the next period tries again.
      this.logger.warn({ event: "kyc.sweep_skipped", err: error }, "the sweep did not run");
    }
  }
}
