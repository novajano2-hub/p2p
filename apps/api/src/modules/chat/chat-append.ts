import { type Prisma, type TradeMessage, type TradeMessageKind } from "@abay/database";
import { v7 as uuidv7 } from "uuid";

/*
  The one way a message is written. A function rather than a provider so
  the trade engine can post an offer's auto-reply inside the transaction
  that opens the trade without importing the chat module's graph.

  The sequence number is the trade's own counter, bumped under the trade's
  row lock, so every message has one place in one order and a client that
  reconnects can ask for "everything after N". Sending also advances the
  sender's own read marker to the new message: what you wrote, you have
  read, and "unread" then counts only the other side's messages.
*/

export interface AppendMessage {
  tradeId: string;
  senderId: string;
  kind: TradeMessageKind;
  body?: string | null | undefined;
  storageKey?: string | undefined;
  contentType?: string | undefined;
  sizeBytes?: number | undefined;
  clientMessageId: string;
}

export async function appendMessage(
  tx: Prisma.TransactionClient,
  input: AppendMessage,
): Promise<TradeMessage> {
  // The counter only; a message is not a change to the trade itself.
  const bumped = await tx.$queryRaw<{ chat_seq: number }[]>`
    UPDATE trades SET chat_seq = chat_seq + 1
     WHERE id = ${input.tradeId}
     RETURNING chat_seq`;
  const seq = bumped[0]?.chat_seq;
  if (seq === undefined) {
    throw new Error(`chat: trade ${input.tradeId} has no row to number a message against`);
  }

  const message = await tx.tradeMessage.create({
    data: {
      id: uuidv7(),
      tradeId: input.tradeId,
      seq,
      senderId: input.senderId,
      kind: input.kind,
      body: input.body ?? null,
      storageKey: input.storageKey ?? null,
      contentType: input.contentType ?? null,
      sizeBytes: input.sizeBytes ?? null,
      clientMessageId: input.clientMessageId,
    },
  });
  await tx.tradeChatRead.upsert({
    where: { tradeId_userId: { tradeId: input.tradeId, userId: input.senderId } },
    create: { tradeId: input.tradeId, userId: input.senderId, lastReadSeq: seq },
    update: { lastReadSeq: seq },
  });
  return message;
}
