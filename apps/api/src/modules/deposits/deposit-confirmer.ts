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
  /** The pass running right now, so that shutdown can wait for it. */
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly deposits: DepositService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DepositConfirmer.name);
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.start(), INTERVAL_MS);
    void this.start();
  }

  /** No new pass starts, and the one in flight finishes before the process lets go of its connections. */
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
  }

  /** A pass, remembered while it runs; a timer firing during one joins it rather than starting another. */
  private start(): Promise<void> {
    this.inFlight ??= this.tick().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
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
