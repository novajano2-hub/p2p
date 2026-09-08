import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";

/*
  The one Redis connection for the process. Redis is never a source of truth
  here (the brief is explicit): queues, rate limits, bounded locks, sessions
  that can be rebuilt. So the client is configured to fail fast and report,
  not to queue commands while the server is away and replay them later.
*/
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(
    @Inject(ENV) env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RedisService.name);
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
    });
    // Without a listener ioredis prints to stderr on every failed reconnect.
    this.client.on("error", (error: Error) => {
      this.logger.warn({ reason: error.message }, "redis connection error");
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
