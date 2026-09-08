import { type DependencyStatus } from "@abay/contracts";
import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { PrismaService } from "@/infra/prisma/prisma.service";
import { RedisService } from "@/infra/redis/redis.service";

/** A probe that hangs is a failed probe. Nothing waits longer than this. */
const CHECK_TIMEOUT_MS = 1_500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);
    // Both branches attach a handler, so the inner promise can never become an
    // unhandled rejection after the timer has already settled the outer one.
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/*
  Each check answers ok or failed and nothing else. The reason is logged
  server-side for the operator; the endpoint never carries it.
*/
@Injectable()
export class ReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ReadinessService.name);
  }

  async database(): Promise<DependencyStatus> {
    try {
      await withTimeout(this.prisma.client.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS);
      return "ok";
    } catch (error) {
      this.logger.warn({ reason: reasonOf(error) }, "readiness: database check failed");
      return "failed";
    }
  }

  async redis(): Promise<DependencyStatus> {
    const client = this.redisService.client;
    try {
      if (client.status === "wait" || client.status === "end" || client.status === "close") {
        await withTimeout(client.connect(), CHECK_TIMEOUT_MS);
      }
      const pong = await withTimeout(client.ping(), CHECK_TIMEOUT_MS);
      return pong === "PONG" ? "ok" : "failed";
    } catch (error) {
      this.logger.warn({ reason: reasonOf(error) }, "readiness: redis check failed");
      return "failed";
    }
  }
}
