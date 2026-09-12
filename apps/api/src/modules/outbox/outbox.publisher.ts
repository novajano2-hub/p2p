import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { RedisService } from "@/infra/redis/redis.service";
import { OutboxService } from "@/modules/outbox/outbox.service";

/*
  The worker's side of the outbox: every few seconds, drain what is due.

  Postgres does the queueing (SKIP LOCKED in OutboxService.drain), so two
  worker replicas would not collide even without the Redis lock; the lock is
  there so that only one of them polls at all, which keeps the database
  quiet when there is nothing to send. Held for one pass, allowed to expire.
*/

const INTERVAL_MS = 5_000;
const LOCK_KEY = "outbox:publish";
const LOCK_TTL_MS = 60_000;
const BATCH = 20;
/** Full batches in a row before yielding to the next tick, so one burst cannot starve the timer. */
const MAX_BATCHES_PER_TICK = 10;

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly outbox: OutboxService,
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutboxPublisher.name);
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
      for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch++) {
        const result = await this.outbox.drain(BATCH);
        if (result.attempted < BATCH) break;
      }
    } catch (error) {
      this.logger.warn({ event: "outbox.tick_failed", err: error }, "the outbox pass did not run");
    } finally {
      this.running = false;
    }
  }
}
