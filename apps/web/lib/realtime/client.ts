import { z } from "zod";

import { apiOrigin } from "@/lib/api-origin";

/*
  The browser's end of the socket (apps/api/src/modules/realtime). One
  connection per tab, opened with the session cookie the API already holds,
  subscribed to the trades the tab is looking at and fed everything that
  happens on them - a message, typing, a read marker, a status change - and
  every notification for the account.

  Nothing is true because it arrived here. A frame says "go and look", and
  the screen that hears it fetches. That keeps the two failure modes
  harmless: a frame that never arrives costs a refetch on the next
  reconnect (every reconnect announces itself so screens catch up), and a
  frame that arrives twice is ignored by whatever it names.

  Reconnecting is the whole job of this file. The server pings; the
  browser answers pings itself, so a dead connection surfaces as a close,
  and a close is answered with a backoff that starts fast and settles at
  thirty seconds - except for two codes the server uses to mean "do not":
  4001, the session has ended, and 4002, too many tabs.
*/

export const REALTIME_PATH = "/v1/ws";

const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

const messageSchema = z.object({
  id: z.string(),
  tradeId: z.string(),
  seq: z.number(),
  senderId: z.string(),
  kind: z.enum(["TEXT", "IMAGE"]),
  body: z.string().nullable(),
  image: z.object({ contentType: z.string(), sizeBytes: z.number() }).nullable(),
  clientMessageId: z.string(),
  createdAt: z.string(),
});

const frameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), userId: z.string(), heartbeatSeconds: z.number() }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("subscribed"), tradeId: z.string(), lastSeq: z.number() }),
  z.object({ type: z.literal("unsubscribed"), tradeId: z.string() }),
  z.object({ type: z.literal("message"), tradeId: z.string(), message: messageSchema }),
  z.object({ type: z.literal("typing"), tradeId: z.string(), userId: z.string() }),
  z.object({
    type: z.literal("read"),
    tradeId: z.string(),
    userId: z.string(),
    lastReadSeq: z.number(),
  }),
  z.object({
    type: z.literal("trade"),
    tradeId: z.string(),
    status: z.string(),
    updatedAt: z.string(),
  }),
  z.object({ type: z.literal("notification"), notification: notificationSchema }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type ServerFrame = z.infer<typeof frameSchema>;
export type FrameOf<T extends ServerFrame["type"]> = Extract<ServerFrame, { type: T }>;

/** What a screen can listen for, beyond the server's own frames. */
export type RealtimeEvent = ServerFrame["type"] | "connected" | "disconnected";

/*
  "closed" is the moment after a drop, and says nothing on screen: most drops
  are a blip the first reconnect mends. Still down after RECONNECTING_AFTER_MS
  is "reconnecting", which a screen shows, quietly. "ended" is the session
  gone (4001); "paused" is this tab stood down because the account has too
  many open (4002) - nothing wrong with the session, so nothing to sign in to.
*/
export type ConnectionState =
  "connecting" | "open" | "closed" | "reconnecting" | "ended" | "paused";

const RECONNECTING_AFTER_MS = 4_000;

type Handler = (frame: ServerFrame | undefined) => void;

/** Close codes the server uses to say "do not come back". */
const SESSION_ENDED = 4001;
const TOO_MANY_CONNECTIONS = 4002;

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private timer: number | null = null;
  private stopped = true;
  private readonly handlers = new Map<RealtimeEvent, Set<Handler>>();
  /** How many screens want each trade, so the last one leaving unsubscribes. */
  private readonly wanted = new Map<string, number>();
  private readonly stateListeners = new Set<() => void>();
  private downTimer: number | null = null;
  state: ConnectionState = "closed";

  constructor(private readonly url: string) {}

  /** Opens the connection and keeps it open until close() is called. */
  connect(): void {
    this.stopped = false;
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.reconnectNow);
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    this.open();
  }

  close(): void {
    this.stopped = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.reconnectNow);
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    this.clearTimer();
    this.clearDownTimer();
    this.socket?.close(1000, "leaving");
    this.socket = null;
    this.setState("closed");
  }

  on(event: RealtimeEvent, handler: Handler): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => {
      set.delete(handler);
    };
  }

  /** Watches a trade while the returned function has not been called. */
  subscribe(tradeId: string): () => void {
    const count = (this.wanted.get(tradeId) ?? 0) + 1;
    this.wanted.set(tradeId, count);
    if (count === 1) this.send({ type: "subscribe", tradeId });
    return () => {
      const left = (this.wanted.get(tradeId) ?? 1) - 1;
      if (left <= 0) {
        this.wanted.delete(tradeId);
        this.send({ type: "unsubscribe", tradeId });
      } else {
        this.wanted.set(tradeId, left);
      }
    };
  }

  /** For useSyncExternalStore: called whenever `state` changes. */
  subscribeState(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /** Says the person is typing in a trade's chat. Ephemeral: dropped when offline. */
  typing(tradeId: string): void {
    this.send({ type: "typing", tradeId });
  }

  /* ------------------------------------------------------------- internals */

  private open(): void {
    if (this.stopped || this.socket) return;
    this.setState("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.setState("open");
      // Everything a screen asked for while we were away, asked for again.
      for (const tradeId of this.wanted.keys()) {
        this.send({ type: "subscribe", tradeId });
      }
      this.emit("connected", undefined);
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      const frame = frameSchema.safeParse(parsed);
      if (frame.success) this.emit(frame.data.type, frame.data);
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return;
      this.socket = null;
      /*
        Why it closed is settled before anyone hears that it did: a listener
        asks the state to tell an ended session (4001) from a blip, and until
        this order was right it always saw the old state and missed it.
      */
      if (!this.stopped) {
        this.setState(
          event.code === SESSION_ENDED
            ? "ended"
            : event.code === TOO_MANY_CONNECTIONS
              ? "paused"
              : "closed",
        );
      }
      this.emit("disconnected", undefined);
      if (this.stopped || this.state === "ended" || this.state === "paused") return;
      // 1001 is the server going away for a moment: come back soon rather
      // than on the first backoff step, which is already short.
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // The close that follows carries what is known; nothing to do here.
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer !== null) return;
    const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 30_000;
    // Jitter, so a fleet of tabs let go by a restart does not return as one.
    const delay = base + Math.floor(Math.random() * base * 0.3);
    this.attempt += 1;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.open();
    }, delay);
  }

  private readonly reconnectNow = (): void => {
    if (this.stopped || this.socket || this.state === "ended") return;
    this.clearTimer();
    this.attempt = 0;
    this.open();
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "visible") this.reconnectNow();
  };

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private send(frame: { type: string; tradeId?: string }): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(frame));
    }
  }

  private setState(state: ConnectionState): void {
    if (state === "open" || state === "ended" || state === "paused") this.clearDownTimer();
    // Down, and not by choice: say so only if it lasts.
    if (
      (state === "closed" || state === "connecting") &&
      !this.stopped &&
      this.downTimer === null
    ) {
      this.downTimer = window.setTimeout(() => {
        this.downTimer = null;
        if (this.state === "closed" || this.state === "connecting") this.setState("reconnecting");
      }, RECONNECTING_AFTER_MS);
    }
    // A reconnect attempt while already "reconnecting" stays "reconnecting" on screen.
    const shown = this.state === "reconnecting" && state === "connecting" ? "reconnecting" : state;
    if (shown === this.state) return;
    this.state = shown;
    for (const listener of this.stateListeners) listener();
  }

  private clearDownTimer(): void {
    if (this.downTimer !== null) {
      window.clearTimeout(this.downTimer);
      this.downTimer = null;
    }
  }

  private emit(event: RealtimeEvent, frame: ServerFrame | undefined): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        handler(frame);
      } catch {
        // One screen's handler must not stop the next from hearing.
      }
    }
  }
}

/** Where the socket lives: the API's origin, over the socket scheme. */
export function realtimeUrl(): string {
  return `${apiOrigin().replace(/^http/, "ws")}${REALTIME_PATH}`;
}
