import { randomUUID } from "node:crypto";

import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { RedisService } from "@/infra/redis/redis.service";
import { TradeService } from "@/modules/trades/trade.service";

/*
  The trade expirer (overview.md, "worker processes"): every few seconds,
  refund every trade whose payment deadline the database says has passed.

  The row lock inside TradeService is what makes a second replica harmless;
  the Redis lock only keeps two workers from doing the same reads. It is
  given back the moment a pass ends, and it expires on its own if the worker
  dies holding it - so a dead worker costs one TTL, and a live one is never
  made to wait out its own lock. The pass touches nothing but trades still
  waiting to be paid: there is no edge out of BUYER_MARKED_PAID for a timer
  to take (AT-4).
*/

const INTERVAL_MS = 5_000;
const LOCK_TTL_MS = 15_000;
export const EXPIRER_LOCK_KEY = "trades:expire";

/** Deletes the lock only while it still holds our token, so a pass that outlived its TTL leaves the next holder's alone. */
const RELEASE_IF_OURS = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0`;

@Injectable()
export class TradeExpirer implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  /** The pass running right now, so that shutdown can wait for it. */
  private inFlight: Promise<number | null> | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly trades: TradeService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TradeExpirer.name);
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    void this.tick();
  }

  /** No new pass starts, and the one in flight finishes before the process lets go of its connections. */
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
  }

  /** One pass: how many trades it expired, or null when it did not run - a pass was already running, another worker held the lock, or it failed. */
  tick(): Promise<number | null> {
    if (this.inFlight) return Promise.resolve(null);
    this.inFlight = this.pass().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async pass(): Promise<number | null> {
    const token = randomUUID();
    let held = false;
    try {
      const claimed = await this.redis.client.set(EXPIRER_LOCK_KEY, token, "PX", LOCK_TTL_MS, "NX");
      held = claimed === "OK";
      if (!held) return null;
      const expired = await this.trades.expireDue();
      if (expired > 0) {
        this.logger.info({ event: "trades.expired", expired }, "unpaid trades expired");
      }
      return expired;
    } catch (error) {
      this.logger.warn(
        { event: "trades.expire_failed", err: error },
        "the expiry pass did not run",
      );
      return null;
    } finally {
      if (held) await this.unlock(token);
    }
  }

  private async unlock(token: string): Promise<void> {
    try {
      await this.redis.client.eval(RELEASE_IF_OURS, 1, EXPIRER_LOCK_KEY, token);
    } catch (error) {
      this.logger.warn(
        { event: "trades.expire_unlock_failed", err: error },
        "could not give the expiry lock back; it expires on its own",
      );
    }
  }
}
