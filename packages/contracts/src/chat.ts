import { z } from "zod";

import { notificationItem } from "./notifications";
import { tradeStatus } from "./trades";

/*
  The trade chat, and the live connection that carries it.

  A trade's two parties talk inside the trade: about the transfer reference,
  a bank that is slow, a name that does not match. The chat is evidence as
  much as conversation - a dispute resolver reads it - so every message is a
  row in PostgreSQL with a place in one order per trade (`seq`), and the
  WebSocket is only how a message reaches the other party quickly. Nothing
  is true because it was seen on the socket; a client that reconnects asks
  the API for everything after the last sequence number it has.
*/

export const tradeMessageKind = z.enum(["TEXT", "IMAGE"]);
export type TradeMessageKind = z.infer<typeof tradeMessageKind>;

/** How long a message may be. Chat, not a letter. */
export const CHAT_MESSAGE_MAX_LENGTH = 2_000;
/** A screenshot of a transfer. Smaller than an identity document. */
export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The client's own id for a message, minted once per send and repeated on
 * every retry, so a message sent over a bad connection arrives once.
 */
export const clientMessageId = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{8,64}$/, { error: "A client message id is 8 to 64 characters." });

export const sendMessageRequest = z.object({
  clientMessageId,
  body: z
    .string()
    .trim()
    .min(1, { error: "Write something first." })
    .max(CHAT_MESSAGE_MAX_LENGTH, {
      error: `Keep it under ${CHAT_MESSAGE_MAX_LENGTH} characters.`,
    }),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequest>;

/** One message. `senderId` rather than "mine": the socket delivers the same frame to both parties. */
export const tradeMessageView = z.object({
  id: z.string(),
  tradeId: z.string(),
  seq: z.number().int().positive(),
  senderId: z.string(),
  kind: tradeMessageKind,
  /** The text, for a TEXT message; null for an image. */
  body: z.string().nullable(),
  /** For an IMAGE: fetch the bytes from /v1/trades/:id/messages/:messageId/image. */
  image: z
    .object({
      contentType: z.string(),
      sizeBytes: z.number().int().nonnegative(),
    })
    .nullable(),
  clientMessageId: z.string(),
  createdAt: z.string(),
});
export type TradeMessageView = z.infer<typeof tradeMessageView>;

export const messagesQuery = z.object({
  /** Everything after this sequence number. Zero, the default, is the whole chat. */
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type MessagesQuery = z.infer<typeof messagesQuery>;

export const messagesResponse = z.object({
  messages: z.array(tradeMessageView),
  /** The trade's newest sequence number, so a client knows whether it is caught up. */
  lastSeq: z.number().int().nonnegative(),
  /** How far each side has read. */
  myLastReadSeq: z.number().int().nonnegative(),
  theirLastReadSeq: z.number().int().nonnegative(),
  /** Whether the chat still accepts messages. */
  open: z.boolean(),
});
export type MessagesResponse = z.infer<typeof messagesResponse>;

export const markReadRequest = z.object({
  seq: z.number().int().nonnegative(),
});
export type MarkReadRequest = z.infer<typeof markReadRequest>;

/* ------------------------------------------------------------- realtime */

/** Where the socket lives, relative to the API origin. */
export const REALTIME_PATH = "/v1/ws";

/** What a client may send up the socket. Small on purpose: sending a message is a POST. */
export const realtimeClientFrame = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribe"), tradeId: z.uuid() }),
  z.object({ type: z.literal("unsubscribe"), tradeId: z.uuid() }),
  z.object({ type: z.literal("typing"), tradeId: z.uuid() }),
  z.object({ type: z.literal("ping") }),
]);
export type RealtimeClientFrame = z.infer<typeof realtimeClientFrame>;

/** What the server sends down. */
export const realtimeServerFrame = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    userId: z.string(),
    serverTime: z.string(),
    /** How often the server pings; a client silent for two of these is gone. */
    heartbeatSeconds: z.number().int().positive(),
  }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("subscribed"), tradeId: z.string(), lastSeq: z.number().int() }),
  z.object({ type: z.literal("unsubscribed"), tradeId: z.string() }),
  z.object({ type: z.literal("message"), tradeId: z.string(), message: tradeMessageView }),
  z.object({ type: z.literal("typing"), tradeId: z.string(), userId: z.string() }),
  z.object({
    type: z.literal("read"),
    tradeId: z.string(),
    userId: z.string(),
    lastReadSeq: z.number().int(),
  }),
  /** The trade changed state. Refetch it; the frame carries no money. */
  z.object({
    type: z.literal("trade"),
    tradeId: z.string(),
    status: tradeStatus,
    updatedAt: z.string(),
  }),
  z.object({ type: z.literal("notification"), notification: notificationItem }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type RealtimeServerFrame = z.infer<typeof realtimeServerFrame>;

/**
 * Close codes the server uses beyond the standard ones, so a client knows
 * whether to reconnect: after 4001 it should sign in again; after 4002 it
 * has too many tabs open; after 1001 the server is restarting and it should
 * come back shortly.
 */
export const REALTIME_CLOSE = {
  SESSION_ENDED: 4001,
  TOO_MANY_CONNECTIONS: 4002,
} as const;
