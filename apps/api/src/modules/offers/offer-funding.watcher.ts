import { randomUUID } from "node:crypto";

import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { RedisService } from "@/infra/redis/redis.service";
import { OfferService, type FundingPass } from "@/modules/offers/offer.service";

/*
  The ad-funding watcher (worker only): every half minute, look at every live
  sell ad against its seller's balance (OfferService.checkFunding). An ad the
  balance no longer covers is already missing from the market - the query
  hides it by itself - so what this adds is the seller hearing about it, and
  the ad going offline after a day of it.

  Shaped like the trade expirer: a short Redis lock so two workers do not do
  the same reads, given back when the pass ends and expiring by itself if the
  worker dies holding it. The conditional updates inside the pass are what
  keep a second worker harmless.
*/

const INTERVAL_MS = 30_000;
const LOCK_TTL_MS = 60_000;
export const FUNDING_LOCK_KEY = "offers:funding";

/** Deletes the lock only while it still holds our token, so a pass that outlived its TTL leaves the next holder's alone. */
const RELEASE_IF_OURS = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0`;

@Injectable()
export class OfferFundingWatcher implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  /** The pass running right now, so that shutdown can wait for it. */
  private inFlight: Promise<FundingPass | null> | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly offers: OfferService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OfferFundingWatcher.name);
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

  /** One pass, or null when it did not run - one was already running, another worker held the lock, or it failed. */
  tick(): Promise<FundingPass | null> {
    if (this.inFlight) return Promise.resolve(null);
    this.inFlight = this.pass().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async pass(): Promise<FundingPass | null> {
    const token = randomUUID();
    let held = false;
    try {
      const claimed = await this.redis.client.set(FUNDING_LOCK_KEY, token, "PX", LOCK_TTL_MS, "NX");
      held = claimed === "OK";
      if (!held) return null;
      const pass = await this.offers.checkFunding();
      if (pass.hidden > 0 || pass.paused > 0 || pass.cleared > 0) {
        this.logger.info({ event: "offers.funding", ...pass }, "ad funding checked");
      }
      return pass;
    } catch (error) {
      this.logger.warn(
        { event: "offers.funding_failed", err: error },
        "the ad funding pass did not run",
      );
      return null;
    } finally {
      if (held) await this.unlock(token);
    }
  }

  private async unlock(token: string): Promise<void> {
    try {
      await this.redis.client.eval(RELEASE_IF_OURS, 1, FUNDING_LOCK_KEY, token);
    } catch (error) {
      this.logger.warn(
        { event: "offers.funding_unlock_failed", err: error },
        "could not give the funding lock back; it expires on its own",
      );
    }
  }
}
