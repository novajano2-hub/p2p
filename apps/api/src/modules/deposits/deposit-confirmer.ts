import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { RedisService } from "@/infra/redis/redis.service";
import { DepositService } from "@/modules/deposits/deposit.service";

/*
  The deposit crediter (overview.md, "worker processes"): every few seconds,
  every CONFIRMING deposit is held up against the chain's head, and the ones
  that have reached finality are credited. The row lock inside
  DepositService is what makes a second replica harmless; the Redis lock
  only keeps the two from doing the same reads.
*/

const INTERVAL_MS = 5_000;
const LOCK_KEY = "deposits:confirm";
const LOCK_TTL_MS = 60_000;

@Injectable()
export class DepositConfirmer implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly redis: RedisService,
    private readonly deposits: DepositService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DepositConfirmer.name);
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
      const tally = await this.deposits.confirmDue();
      if (tally.credited + tally.held + tally.orphaned > 0) {
        this.logger.info({ event: "deposits.confirmed", ...tally }, "deposit confirmation pass");
      }
    } catch (error) {
      this.logger.warn(
        { event: "deposits.confirm_failed", err: error },
        "the confirmer pass did not run",
      );
    } finally {
      this.running = false;
    }
  }
}
