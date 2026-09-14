import {
  CHAT_IMAGE_MAX_BYTES,
  type MessagesQuery,
  type MessagesResponse,
  type SendMessageRequest,
  type TradeMessageView,
} from "@abay/contracts";
import { type Prisma, type Trade, type TradeMessage } from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { v7 as uuidv7 } from "uuid";

import { AppError } from "@/common/errors/app-error";
import { afterCommit } from "@/common/io/transaction-scope";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { OBJECT_STORE, StorageError, type ObjectStore } from "@/infra/storage/object-store";
import { appendMessage } from "@/modules/chat/chat-append";
import { IMAGE_EXTENSIONS, sniffImageType } from "@/modules/kyc/image-type";
import { RealtimeService, topics } from "@/modules/realtime/realtime.service";
import { isOpen } from "@/modules/trades/trade.machine";

/*
  The trade chat, from the parties' side.

  Every read and write starts by finding the trade with the caller as one
  of its two parties; a trade they are not party to does not exist here
  (AT-6). A message is a row first and a frame second: it is written under
  the trade's row lock, numbered by the trade's own counter, and published
  for whoever is connected only once the row is durable. A client that
  missed the frame asks for everything after the last number it has.

  The chat stays open for a while after the trade closes - long enough to
  sort out a payment that landed late - and then becomes read-only, for the
  parties and for a dispute resolver alike.
*/

const HOUR_MS = 3_600_000;

type Tx = Prisma.TransactionClient;
type Parties = Pick<Trade, "id" | "buyerId" | "sellerId">;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    private readonly realtime: RealtimeService,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ChatService.name);
  }

  async list(userId: string, tradeId: string, query: MessagesQuery): Promise<MessagesResponse> {
    const trade = await this.party(this.prisma.client, userId, tradeId);
    const [messages, reads] = await Promise.all([
      this.prisma.client.tradeMessage.findMany({
        where: { tradeId, seq: { gt: query.after } },
        orderBy: { seq: "asc" },
        take: query.limit,
      }),
      this.prisma.client.tradeChatRead.findMany({ where: { tradeId } }),
    ]);
    const other = trade.buyerId === userId ? trade.sellerId : trade.buyerId;
    return {
      messages: messages.map(toView),
      lastSeq: trade.chatSeq,
      myLastReadSeq: reads.find((read) => read.userId === userId)?.lastReadSeq ?? 0,
      theirLastReadSeq: reads.find((read) => read.userId === other)?.lastReadSeq ?? 0,
      open: this.canChat(trade),
    };
  }

  /**
   * A text message. Idempotent on the client's own message id, so a retry
   * over a bad connection is the same message, answered with the row the
   * first attempt wrote.
   */
  async send(
    userId: string,
    tradeId: string,
    input: SendMessageRequest,
  ): Promise<TradeMessageView> {
    const message = await this.prisma.transaction("chat:send", async (tx) => {
      const trade = await this.lockParty(tx, userId, tradeId);
      const earlier = await tx.tradeMessage.findUnique({
        where: {
          tradeId_senderId_clientMessageId: {
            tradeId,
            senderId: userId,
            clientMessageId: input.clientMessageId,
          },
        },
      });
      if (earlier) return earlier;
      this.assertOpen(trade);
      const written = await appendMessage(tx, {
        tradeId,
        senderId: userId,
        kind: "TEXT",
        body: input.body,
        clientMessageId: input.clientMessageId,
      });
      this.announce(trade, written);
      return written;
    });
    return toView(message);
  }

  /*
    A screenshot. The bytes go to the store before the transaction opens -
    a bucket write is network I/O and must not run under a row lock (AT-19)
    - and are removed again if the row cannot be written. What the bytes are
    is read from the bytes; the request's own claim is never trusted.
  */
  async sendImage(
    userId: string,
    tradeId: string,
    clientMessageId: string,
    bytes: Buffer,
  ): Promise<TradeMessageView> {
    const trade = await this.party(this.prisma.client, userId, tradeId);
    this.assertOpen(trade);
    const contentType = sniffImageType(bytes);
    if (!contentType) {
      throw AppError.validation(
        [{ path: "file", message: "That file is not a JPEG, PNG or WebP image." }],
        "Send the image as a JPEG, PNG or WebP.",
      );
    }
    if (bytes.length > CHAT_IMAGE_MAX_BYTES) {
      throw AppError.validation(
        [
          {
            path: "file",
            message: `Images must be under ${CHAT_IMAGE_MAX_BYTES / 1024 / 1024} MB.`,
          },
        ],
        "That image is too large.",
      );
    }
    const earlier = await this.prisma.client.tradeMessage.findUnique({
      where: { tradeId_senderId_clientMessageId: { tradeId, senderId: userId, clientMessageId } },
    });
    if (earlier) return toView(earlier);

    const key = `trades/${tradeId}/chat/${uuidv7()}.${IMAGE_EXTENSIONS[contentType]}`;
    try {
      await this.store.put({ key, body: bytes, contentType });
    } catch (error) {
      if (error instanceof StorageError) {
        throw AppError.notReady("We could not save the image right now. Please try again.");
      }
      throw error;
    }

    let message: TradeMessage;
    try {
      message = await this.prisma.transaction("chat:send-image", async (tx) => {
        const locked = await this.lockParty(tx, userId, tradeId);
        this.assertOpen(locked);
        const raced = await tx.tradeMessage.findUnique({
          where: {
            tradeId_senderId_clientMessageId: { tradeId, senderId: userId, clientMessageId },
          },
        });
        if (raced) return raced;
        const written = await appendMessage(tx, {
          tradeId,
          senderId: userId,
          kind: "IMAGE",
          storageKey: key,
          contentType,
          sizeBytes: bytes.length,
          clientMessageId,
        });
        this.announce(locked, written);
        return written;
      });
    } catch (error) {
      await this.discard(key);
      throw error;
    }
    if (message.storageKey !== key) {
      // A retry won the race with itself; the second copy of the bytes is waste.
      await this.discard(key);
    }
    return toView(message);
  }

  /** The bytes of an image message, to one of the trade's parties only. */
  async image(
    userId: string,
    tradeId: string,
    messageId: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    await this.party(this.prisma.client, userId, tradeId);
    return this.imageBytes(tradeId, messageId);
  }

  /** The same, for whoever has already been authorised another way - a dispute resolver. */
  async imageBytes(
    tradeId: string,
    messageId: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    const message = await this.prisma.client.tradeMessage.findFirst({
      where: { id: messageId, tradeId, kind: "IMAGE" },
      select: { storageKey: true, contentType: true },
    });
    if (!message?.storageKey || !message.contentType) return null;
    let body: Buffer | null;
    try {
      body = await this.store.get(message.storageKey);
    } catch (error) {
      if (error instanceof StorageError) {
        throw AppError.notReady("We could not load that image right now. Please try again.");
      }
      throw error;
    }
    return body ? { body, contentType: message.contentType } : null;
  }

  /** How far this party has read. Never moves backwards, never past the end. */
  async markRead(userId: string, tradeId: string, seq: number): Promise<void> {
    const trade = await this.party(this.prisma.client, userId, tradeId);
    const bounded = Math.min(seq, trade.chatSeq);
    const current = await this.prisma.client.tradeChatRead.findUnique({
      where: { tradeId_userId: { tradeId, userId } },
    });
    if (current && current.lastReadSeq >= bounded) return;
    await this.prisma.client.tradeChatRead.upsert({
      where: { tradeId_userId: { tradeId, userId } },
      create: { tradeId, userId, lastReadSeq: bounded },
      update: { lastReadSeq: bounded },
    });
    await this.realtime.publish({
      topics: [topics.trade(tradeId)],
      frame: { type: "read", tradeId, userId, lastReadSeq: bounded },
      exclude: userId,
    });
  }

  /** The whole transcript, for a dispute resolver. Authorisation is the caller's. */
  async transcript(tradeId: string): Promise<TradeMessageView[]> {
    const messages = await this.prisma.client.tradeMessage.findMany({
      where: { tradeId },
      orderBy: { seq: "asc" },
    });
    return messages.map(toView);
  }

  /* ------------------------------------------------------------- plumbing */

  private canChat(trade: Pick<Trade, "status" | "closedAt">): boolean {
    if (isOpen(trade.status)) return true;
    return (
      trade.closedAt !== null &&
      Date.now() - trade.closedAt.getTime() < this.env.TRADE_CHAT_AFTER_CLOSE_HOURS * HOUR_MS
    );
  }

  private assertOpen(trade: Pick<Trade, "status" | "closedAt">): void {
    if (!this.canChat(trade)) {
      throw AppError.conflict("This trade's chat is closed.");
    }
  }

  /** The trade, if this customer is a party to it. Otherwise it does not exist. */
  private async party(reader: Pick<Tx, "trade">, userId: string, tradeId: string): Promise<Trade> {
    const trade = await reader.trade.findFirst({
      where: { id: tradeId, OR: [{ buyerId: userId }, { sellerId: userId }] },
    });
    if (!trade) throw AppError.notFound("There is no such trade.");
    return trade;
  }

  private async lockParty(tx: Tx, userId: string, tradeId: string): Promise<Trade> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM trades
       WHERE id = ${tradeId} AND (buyer_id = ${userId} OR seller_id = ${userId})
         FOR UPDATE`;
    if (!rows[0]) throw AppError.notFound("There is no such trade.");
    return tx.trade.findUniqueOrThrow({ where: { id: tradeId } });
  }

  /**
   * To the trade's watchers and to both parties' own channels - once the
   * row is committed, never from inside the transaction. Called with the
   * transaction still open; the frame goes out after it returns.
   */
  private announce(trade: Parties, message: TradeMessage): void {
    void afterCommit(() =>
      this.realtime.publish({
        topics: [topics.trade(trade.id), topics.user(trade.buyerId), topics.user(trade.sellerId)],
        frame: { type: "message", tradeId: trade.id, message: toView(message) },
      }),
    );
  }

  private async discard(key: string): Promise<void> {
    try {
      await this.store.delete(key);
    } catch (error) {
      this.logger.warn(
        { event: "chat.image_discard_failed", key, err: error },
        "an image was left in the store",
      );
    }
  }
}

export function toView(row: TradeMessage): TradeMessageView {
  return {
    id: row.id,
    tradeId: row.tradeId,
    seq: row.seq,
    senderId: row.senderId,
    kind: row.kind,
    body: row.body,
    image:
      row.kind === "IMAGE" && row.contentType !== null && row.sizeBytes !== null
        ? { contentType: row.contentType, sizeBytes: row.sizeBytes }
        : null,
    clientMessageId: row.clientMessageId,
    createdAt: row.createdAt.toISOString(),
  };
}
