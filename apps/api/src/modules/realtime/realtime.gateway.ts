import { type IncomingMessage, type Server as HttpServer } from "node:http";
import { type Duplex } from "node:stream";

import {
  REALTIME_CLOSE,
  REALTIME_PATH,
  realtimeClientFrame,
  type RealtimeServerFrame,
} from "@abay/contracts";
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type Redis from "ioredis";
import { PinoLogger } from "nestjs-pino";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { isCrossSiteRequest, singleHeader } from "@/common/security/csrf";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { RedisService } from "@/infra/redis/redis.service";
import { SESSION_COOKIE, SessionService } from "@/modules/auth/session.service";
import { REALTIME_CHANNEL, type RealtimeEnvelope } from "@/modules/realtime/realtime.service";

/*
  The socket server: one connection per browser tab, subscribed to the
  trades it is looking at, fed from the Redis channel every API replica
  listens to.

  The boundary is the same as HTTP's, enforced at the upgrade before a
  socket exists: the Origin must be one we serve (a cross-site page cannot
  open a socket that rides on the session cookie - the WebSocket equivalent
  of CSRF), and the session cookie must resolve to a live session. A
  request that fails either is answered with a plain HTTP status and the
  TCP connection is closed; nothing is upgraded on the promise of proving
  itself later.

  Everything after that is about not trusting the client to be well
  behaved: frames are validated by schema, counted against a rate, and
  capped in size; a client that will not read what it is sent is dropped
  rather than buffered; a session that is revoked while the socket is open
  is closed within a minute; and a client that stops answering pings is
  gone within two heartbeats. The socket never carries money and never
  decides anything - it only says "something changed, go and look".
*/

/** Tabs per account. A person has a few; a script has hundreds. */
const MAX_CONNECTIONS_PER_USER = 8;
/** Trades one connection may watch at once. */
const MAX_SUBSCRIPTIONS = 20;
/** Frames a client may send in ten seconds before it is cut off. */
const MAX_FRAMES_PER_10S = 30;
/** Malformed frames tolerated before the connection is closed. */
const MAX_STRIKES = 3;
/** The largest frame a client may send. Sending a message is a POST, not a frame. */
const MAX_PAYLOAD_BYTES = 16 * 1024;
/** Unsent bytes queued for one client before it is judged a slow consumer. */
const MAX_BUFFERED_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 30_000;
/** How often an open socket's session is checked against the database. */
const REVALIDATE_MS = 60_000;
/** How long shutdown waits for clients to answer the close handshake before cutting them off. */
const CLOSE_GRACE_MS = 1_000;

interface Client {
  socket: WebSocket;
  userId: string;
  sessionId: string;
  token: string;
  subscriptions: Set<string>;
  alive: boolean;
  /** Timestamps of recent frames, for the rate. */
  frames: number[];
  strikes: number;
  openedAt: number;
}

@Injectable()
export class RealtimeGateway implements OnModuleInit, OnModuleDestroy {
  private wss: WebSocketServer | null = null;
  private server: HttpServer | null = null;
  private subscriber: Redis | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private revalidation: NodeJS.Timeout | null = null;
  private closing = false;

  private readonly clients = new Set<Client>();
  private readonly byUser = new Map<string, Set<Client>>();
  private readonly byTrade = new Map<string, Set<Client>>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RealtimeGateway.name);
  }

  /* ------------------------------------------------------------ lifecycle */

  async onModuleInit(): Promise<void> {
    this.server = this.adapterHost.httpAdapter.getHttpServer() as HttpServer;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
    this.server.on("upgrade", this.onUpgrade);

    this.heartbeat = setInterval(() => {
      this.pingAll();
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
    this.revalidation = setInterval(() => void this.revalidate(), REVALIDATE_MS);
    this.revalidation.unref();

    /*
      A second connection, because a Redis client in subscriber mode can do
      nothing else. It reconnects and re-subscribes on its own; while it is
      away, frames are simply not delivered by this replica.
    */
    this.subscriber = this.redis.client.duplicate();
    this.subscriber.on("error", (error: Error) => {
      this.logger.warn({ reason: error.message }, "realtime subscriber connection error");
    });
    this.subscriber.on("message", (_channel: string, raw: string) => {
      this.onEnvelope(raw);
    });
    try {
      await this.subscriber.connect();
      await this.subscriber.subscribe(REALTIME_CHANNEL);
    } catch (error) {
      this.logger.warn(
        { reason: error instanceof Error ? error.message : "unknown" },
        "realtime subscriber unavailable at startup; will keep retrying",
      );
    }
  }

  /*
    Shutdown says 1001 Going Away to everyone - the one code a client should
    read as "come back shortly" - waits a moment for the close handshakes,
    and cuts off whoever did not answer, so the HTTP server's own close is
    never left waiting on a hijacked socket.
  */
  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.revalidation) clearInterval(this.revalidation);
    this.server?.off("upgrade", this.onUpgrade);
    for (const client of this.clients) client.socket.close(1001, "server restarting");
    await this.drained(CLOSE_GRACE_MS);
    for (const client of this.clients) client.socket.terminate();
    this.wss?.close();
    try {
      await this.subscriber?.quit();
    } catch {
      this.subscriber?.disconnect();
    }
  }

  /** How many sockets are open, for /ready and for tests. */
  get connections(): number {
    return this.clients.size;
  }

  /* -------------------------------------------------------------- upgrade */

  private readonly onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    // A socket that errors before the upgrade completes must not take the process down.
    socket.on("error", () => undefined);
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== REALTIME_PATH) {
      refuse(socket, 404);
      return;
    }
    void this.accept(request, socket, head);
  };

  private async accept(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (this.closing || !this.wss) {
      refuse(socket, 503);
      return;
    }

    const origin = singleHeader(request.headers.origin);
    const secFetchSite = singleHeader(request.headers["sec-fetch-site"]);
    if (isCrossSiteRequest(origin, secFetchSite, this.env.CORS_ORIGINS)) {
      this.logger.warn(
        { event: "realtime.origin_rejected", origin },
        "socket from an origin that is not allowed",
      );
      refuse(socket, 403);
      return;
    }

    const token = cookieValue(request.headers.cookie, SESSION_COOKIE);
    if (!token) {
      refuse(socket, 401);
      return;
    }
    let session;
    try {
      session = await this.sessions.resolveToken(token);
    } catch (error) {
      this.logger.warn(
        { event: "realtime.session_lookup_failed", err: error },
        "could not resolve a session",
      );
      refuse(socket, 503);
      return;
    }
    if (!session) {
      refuse(socket, 401);
      return;
    }
    if (socket.destroyed) return;
    if (this.closing) {
      refuse(socket, 503);
      return;
    }

    /*
      The oldest tab makes way for the newest: a person who opened a ninth
      tab expects the ninth to work, and the first is the one they have
      forgotten about.
    */
    const mine = this.byUser.get(session.user.id);
    if (mine && mine.size >= MAX_CONNECTIONS_PER_USER) {
      const oldest = [...mine].sort((a, b) => a.openedAt - b.openedAt)[0];
      oldest?.socket.close(REALTIME_CLOSE.TOO_MANY_CONNECTIONS, "too many connections");
    }

    const { user, sessionId } = session;
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.attach(ws, { userId: user.id, sessionId, token });
    });
  }

  private attach(
    socket: WebSocket,
    who: { userId: string; sessionId: string; token: string },
  ): void {
    const client: Client = {
      socket,
      userId: who.userId,
      sessionId: who.sessionId,
      token: who.token,
      subscriptions: new Set(),
      alive: true,
      frames: [],
      strikes: 0,
      openedAt: Date.now(),
    };
    this.clients.add(client);
    index(this.byUser, client.userId, client);

    socket.on("pong", () => {
      client.alive = true;
    });
    socket.on("message", (data: RawData, isBinary: boolean) => {
      void this.onFrame(client, data, isBinary);
    });
    socket.on("close", () => {
      this.detach(client);
    });
    socket.on("error", (error: Error) => {
      this.logger.debug({ reason: error.message }, "socket error");
    });

    this.send(client, {
      type: "hello",
      userId: client.userId,
      serverTime: new Date().toISOString(),
      heartbeatSeconds: HEARTBEAT_MS / 1_000,
    });
  }

  private detach(client: Client): void {
    this.clients.delete(client);
    unindex(this.byUser, client.userId, client);
    for (const tradeId of client.subscriptions) unindex(this.byTrade, tradeId, client);
    client.subscriptions.clear();
  }

  /* --------------------------------------------------------------- frames */

  private async onFrame(client: Client, data: RawData, isBinary: boolean): Promise<void> {
    const now = Date.now();
    client.frames = client.frames.filter((at) => at > now - 10_000);
    if (client.frames.length >= MAX_FRAMES_PER_10S) {
      client.socket.close(1008, "too many frames");
      return;
    }
    client.frames.push(now);

    if (isBinary) {
      this.strike(client, "binary frames are not accepted");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawToString(data));
    } catch {
      this.strike(client, "frames must be JSON");
      return;
    }
    const frame = realtimeClientFrame.safeParse(parsed);
    if (!frame.success) {
      this.strike(client, "that is not a frame this server understands");
      return;
    }

    switch (frame.data.type) {
      case "ping":
        this.send(client, { type: "pong" });
        return;
      case "subscribe":
        await this.subscribe(client, frame.data.tradeId);
        return;
      case "unsubscribe":
        client.subscriptions.delete(frame.data.tradeId);
        unindex(this.byTrade, frame.data.tradeId, client);
        this.send(client, { type: "unsubscribed", tradeId: frame.data.tradeId });
        return;
      case "typing":
        // Ephemeral, and only about a trade the client is actually in.
        if (!client.subscriptions.has(frame.data.tradeId)) return;
        await this.fanOut({
          topics: [`trade:${frame.data.tradeId}`],
          frame: { type: "typing", tradeId: frame.data.tradeId, userId: client.userId },
          exclude: client.userId,
        });
        return;
    }
  }

  /**
   * Watching a trade means being one of its two parties. Anyone else - and
   * a trade that does not exist - gets the same answer, so the socket cannot
   * be used to test which trade ids are real (AT-6).
   */
  private async subscribe(client: Client, tradeId: string): Promise<void> {
    if (client.subscriptions.has(tradeId)) {
      const trade = await this.membership(client.userId, tradeId);
      this.send(client, { type: "subscribed", tradeId, lastSeq: trade?.chatSeq ?? 0 });
      return;
    }
    if (client.subscriptions.size >= MAX_SUBSCRIPTIONS) {
      this.send(client, {
        type: "error",
        code: "too_many_subscriptions",
        message: `A connection may watch up to ${MAX_SUBSCRIPTIONS} trades.`,
      });
      return;
    }
    const trade = await this.membership(client.userId, tradeId);
    if (!trade) {
      this.send(client, { type: "error", code: "not_found", message: "There is no such trade." });
      return;
    }
    client.subscriptions.add(tradeId);
    index(this.byTrade, tradeId, client);
    this.send(client, { type: "subscribed", tradeId, lastSeq: trade.chatSeq });
  }

  private membership(userId: string, tradeId: string): Promise<{ chatSeq: number } | null> {
    return this.prisma.client.trade.findFirst({
      where: { id: tradeId, OR: [{ buyerId: userId }, { sellerId: userId }] },
      select: { chatSeq: true },
    });
  }

  private strike(client: Client, message: string): void {
    client.strikes += 1;
    if (client.strikes >= MAX_STRIKES) {
      client.socket.close(1008, "protocol violation");
      return;
    }
    this.send(client, { type: "error", code: "bad_frame", message });
  }

  /* ------------------------------------------------------------- delivery */

  private onEnvelope(raw: string): void {
    let envelope: RealtimeEnvelope;
    try {
      envelope = JSON.parse(raw) as RealtimeEnvelope;
    } catch {
      this.logger.warn({ event: "realtime.bad_envelope" }, "an unreadable envelope was published");
      return;
    }
    this.deliver(envelope);
  }

  /** Publishes so every replica, this one included, delivers it. */
  private async fanOut(envelope: RealtimeEnvelope): Promise<void> {
    try {
      await this.redis.client.publish(REALTIME_CHANNEL, JSON.stringify(envelope));
    } catch (error) {
      this.logger.debug({ err: error }, "could not publish; delivering locally only");
      this.deliver(envelope);
    }
  }

  private deliver(envelope: RealtimeEnvelope): void {
    const targets = new Set<Client>();
    for (const topic of envelope.topics) {
      const [kind, id] = topic.split(":");
      const set =
        kind === "user" && id
          ? this.byUser.get(id)
          : kind === "trade" && id
            ? this.byTrade.get(id)
            : undefined;
      for (const client of set ?? []) targets.add(client);
    }
    for (const client of targets) {
      if (envelope.exclude && client.userId === envelope.exclude) continue;
      this.send(client, envelope.frame);
    }
  }

  private send(client: Client, frame: RealtimeServerFrame): void {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    /*
      A client that is not reading is not a client worth buffering for: the
      memory it costs is the process's, and it will refetch on reconnect.
    */
    if (client.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      client.socket.close(1008, "slow consumer");
      return;
    }
    client.socket.send(JSON.stringify(frame));
  }

  /* --------------------------------------------------------- housekeeping */

  private pingAll(): void {
    for (const client of this.clients) {
      if (!client.alive) {
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }

  /**
   * A session revoked - sign-out elsewhere, a password change, a support
   * action - must reach an open socket too, not only the next HTTP request.
   * Checked on a timer rather than by hooking every revocation, so the set
   * of things that end a session stays in one place (SessionService). The
   * check does not count as activity: an open tab must not keep an idle
   * session alive by itself. Public so a test can run a pass on demand.
   */
  async revalidate(): Promise<void> {
    for (const client of [...this.clients]) {
      try {
        const session = await this.sessions.resolveToken(client.token, { touch: false });
        if (session?.sessionId !== client.sessionId) {
          client.socket.close(REALTIME_CLOSE.SESSION_ENDED, "session ended");
        }
      } catch (error) {
        this.logger.debug({ err: error }, "could not revalidate a socket's session");
      }
    }
  }

  /** Resolves once every socket has gone, or after `ms`. */
  private async drained(ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (this.clients.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

/* --------------------------------------------------------------- helpers */

const STATUS_TEXT: Record<number, string> = {
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  503: "Service Unavailable",
};

/** Answers the upgrade request with a plain HTTP status and closes the connection. */
function refuse(socket: Duplex, status: number): void {
  if (socket.destroyed) return;
  socket.write(
    `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? ""}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

/** The value of one cookie from a raw Cookie header, or null. */
export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    if (value.length === 0) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

function index(map: Map<string, Set<Client>>, key: string, client: Client): void {
  const set = map.get(key) ?? new Set<Client>();
  set.add(client);
  map.set(key, set);
}

function unindex(map: Map<string, Set<Client>>, key: string, client: Client): void {
  const set = map.get(key);
  if (!set) return;
  set.delete(client);
  if (set.size === 0) map.delete(key);
}
