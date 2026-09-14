import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { RedisService } from "@/infra/redis/redis.service";
import { WithdrawalService } from "@/modules/withdrawals/withdrawal.service";

/*
  The withdrawal builder and broadcaster, and the confirmer behind it
  (overview.md, "worker processes"). Two passes on one timer: send what has
  been approved, then settle what has been sent.

  The row lock inside WithdrawalService is what makes a second replica
  harmless; the Redis lock only keeps two workers from doing the same reads.
  Neither pass can touch a withdrawal whose broadcast outcome is unknown -
  the state machine has no edge for it - so no amount of retrying, restarting
  or racing here can send a customer's money twice (AT-9).
*/

const INTERVAL_MS = 5_000;
const LOCK_KEY = "withdrawals:process";
const LOCK_TTL_MS = 120_000;

@Injectable()
export class WithdrawalProcessor implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** The pass running right now, so that shutdown can wait for it. */
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly withdrawals: WithdrawalService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WithdrawalProcessor.name);
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
      const sent = await this.withdrawals.processApproved();
      const settled = await this.withdrawals.confirmBroadcast();
      if (
        sent.broadcast + sent.failed + sent.unknown + settled.confirmed + settled.investigating >
        0
      ) {
        this.logger.info(
          { event: "withdrawals.processed", ...sent, ...settled },
          "withdrawal pass",
        );
      }
    } catch (error) {
      this.logger.warn(
        { event: "withdrawals.process_failed", err: error },
        "the withdrawal pass did not run",
      );
    } finally {
      this.running = false;
    }
  }
}
