import { type RealtimeServerFrame, type TradeStatus } from "@abay/contracts";
import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { assertNoOpenTransaction } from "@/common/io/transaction-scope";
import { RedisService } from "@/infra/redis/redis.service";

/*
  The publishing half of realtime, usable from any process.

  An event goes to one Redis channel; every API replica subscribes to it and
  hands the frame to whichever of its sockets belong to the topic. That is
  what lets the worker's expirer tell a browser connected to a different
  process that a trade just expired, and what lets two API replicas behind a
  load balancer serve the two parties of one chat.

  Best effort, by design. Redis is never a source of truth here (the brief
  is explicit); a frame that does not arrive costs a client a refetch, which
  every client does on reconnect anyway. So publishing never throws to its
  caller and never runs inside a database transaction (AT-19).
*/

export const REALTIME_CHANNEL = "rt:events";

export interface RealtimeEnvelope {
  /** "user:<id>" or "trade:<id>". A frame may go to several; a socket gets it once. */
  topics: readonly string[];
  frame: RealtimeServerFrame;
  /** A user id whose sockets should NOT receive it: the sender of a typing notice. */
  exclude?: string | undefined;
}

export const topics = {
  user: (userId: string): string => `user:${userId}`,
  trade: (tradeId: string): string => `trade:${tradeId}`,
} as const;

@Injectable()
export class RealtimeService {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RealtimeService.name);
  }

  async publish(envelope: RealtimeEnvelope): Promise<void> {
    assertNoOpenTransaction("publishing a realtime event");
    try {
      await this.redis.client.publish(REALTIME_CHANNEL, JSON.stringify(envelope));
    } catch (error) {
      this.logger.warn(
        { event: "realtime.publish_failed", frame: envelope.frame.type, err: error },
        "a realtime event was not delivered; clients will catch up on refetch",
      );
    }
  }

  /** A trade changed state: both parties, and anyone watching the trade. */
  tradeChanged(trade: {
    id: string;
    buyerId: string;
    sellerId: string;
    status: TradeStatus;
    updatedAt: Date;
  }): Promise<void> {
    return this.publish({
      topics: [topics.trade(trade.id), topics.user(trade.buyerId), topics.user(trade.sellerId)],
      frame: {
        type: "trade",
        tradeId: trade.id,
        status: trade.status,
        updatedAt: trade.updatedAt.toISOString(),
      },
    });
  }
}
