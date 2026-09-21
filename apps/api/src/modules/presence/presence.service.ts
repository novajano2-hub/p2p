import { PRESENCE_ONLINE_MINUTES } from "@abay/contracts";
import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { PrismaService } from "@/infra/prisma/prisma.service";
import { RedisService } from "@/infra/redis/redis.service";

/*
  Whether the person behind a name is around: the green dot beside an
  advertiser or a counterparty, and "last online 3 hours ago" when they are
  not. Shown to everyone who can see the name, with no way to turn it off -
  the owner's decision, the same as Binance: an advertiser who is away is an
  order that will expire unpaid.

  Two witnesses, and the later one wins. The live connection: every open tab
  is heard from on each heartbeat, and the replica holding it writes the time
  into Redis, so a tab on one replica puts its owner online for a reader on
  another. And the session: a request moves its lastUsedAt, at most once a
  minute. Online means one of them saw the person within the last
  PRESENCE_ONLINE_MINUTES; the time they were last seen is the later of the
  two, to the minute - enough to answer "is anybody there", and no more,
  because strangers read it.

  With one exception, which is the case people check: closing the last tab is
  leaving. The window exists for a connection that stopped being heard from
  without saying why - a server killed, a phone in a tunnel - where the person
  may well still be there. Someone who closed the browser is not, and an
  advertiser shown as online for five more minutes is an order opened with
  nobody to answer it. So the live connection's word is either a time it heard
  from them, or - written negative - the time they left: offline from that
  moment, unless a session has been used since.

  Redis is no more the truth here than anywhere else (see RedisService). If it
  is away, or has lost the key, the session's time answers alone, a little
  staler; nothing is ever refused for want of it.
*/

const ONLINE_MS = PRESENCE_ONLINE_MINUTES * 60_000;
/** As long as a customer session can live: past that, the session has no later time to add either. */
const REMEMBER_SECONDS = 30 * 24 * 60 * 60;
const MINUTE_MS = 60_000;

const keyOf = (userId: string) => `presence:${userId}`;

export interface Presence {
  online: boolean;
  /** To the minute. Null when neither witness has anything. */
  lastSeenAt: string | null;
}

@Injectable()
export class PresenceService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PresenceService.name);
  }

  /**
   * These accounts were just seen on the live connection. Best effort: a
   * write that fails costs a little staleness until the next heartbeat, so it
   * is never allowed to fail the socket that caused it.
   */
  async seen(userIds: Iterable<string>, at = Date.now()): Promise<void> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    try {
      const batch = this.redis.client.pipeline();
      for (const id of ids) batch.set(keyOf(id), String(at), "EX", REMEMBER_SECONDS);
      await batch.exec();
    } catch (error) {
      this.logger.debug({ err: error }, "could not record presence");
    }
  }

  /**
   * Their last tab on this replica has closed: they have left, and this is
   * when. Unless somebody has heard from them since this replica last did -
   * a tab of theirs on another replica - whose word stands. One step in
   * Redis, so that a heartbeat landing in between is not written over. Best
   * effort, like seen(): failing leaves them online for the window, as before.
   */
  async left(userId: string, at: number, heardHereAt: number): Promise<void> {
    try {
      await this.redis.client.eval(
        LEAVE,
        1,
        keyOf(userId),
        String(-at),
        String(heardHereAt),
        String(REMEMBER_SECONDS),
      );
    } catch (error) {
      this.logger.debug({ err: error }, "could not record a departure");
    }
  }

  /** Each account's presence, from one read of each witness however many are asked about. */
  async of(userIds: Iterable<string>, now = Date.now()): Promise<Map<string, Presence>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const [heard, used] = await Promise.all([this.heard(ids), this.used(ids)]);
    return new Map(ids.map((id) => [id, presenceFrom(heard.get(id) ?? 0, used.get(id) ?? 0, now)]));
  }

  /**
   * What the live connection last said of each: a time it heard from them,
   * or, negative, the time they left. Empty when Redis cannot say.
   */
  private async heard(ids: string[]): Promise<Map<string, number>> {
    try {
      const values = await this.redis.client.mget(ids.map(keyOf));
      const heard = new Map<string, number>();
      ids.forEach((id, index) => {
        const at = Number(values[index] ?? "");
        if (Number.isFinite(at) && at !== 0) heard.set(id, at);
      });
      return heard;
    } catch (error) {
      this.logger.debug({ err: error }, "could not read presence; sessions answer alone");
      return new Map();
    }
  }

  /** When each last used a session, as the session records it. */
  private async used(ids: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.client.session.groupBy({
      by: ["userId"],
      where: { userId: { in: ids } },
      _max: { lastUsedAt: true },
    });
    const used = new Map<string, number>();
    for (const row of rows) {
      const at = row._max.lastUsedAt;
      if (at) used.set(row.userId, at.getTime());
    }
    return used;
  }
}

/**
 * The answer for someone last seen at `lastMs` (0: never), asked at `now`.
 * A time ahead of `now` - another replica's clock running fast - is taken
 * as now.
 */
export function presenceAt(lastMs: number, now: number): Presence {
  if (lastMs <= 0) return { online: false, lastSeenAt: null };
  const last = Math.min(lastMs, now);
  return {
    online: now - last <= ONLINE_MS,
    lastSeenAt: new Date(Math.floor(last / MINUTE_MS) * MINUTE_MS).toISOString(),
  };
}

/**
 * The two witnesses together. `heard` is the live connection's word: a time
 * it heard from them, or, negative, the time their last tab closed. `used` is
 * when a session of theirs was last used. Someone who left is offline from
 * that moment - unless a session has been used since, which is them back.
 */
export function presenceFrom(heard: number, used: number, now: number): Presence {
  const heardAt = Math.abs(heard);
  const presence = presenceAt(Math.max(heardAt, used), now);
  const gone = heard < 0 && used <= heardAt;
  return gone ? { ...presence, online: false } : presence;
}

/*
  KEYS[1] the presence key; ARGV[1] what to write (the departure, negative);
  ARGV[2] when this replica last heard from them; ARGV[3] seconds to keep it.
  A value whose time is later than ARGV[2] was written by somebody else, since.
*/
const LEAVE = `
local current = tonumber(redis.call('GET', KEYS[1]))
if current and math.abs(current) > tonumber(ARGV[2]) then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[3]))
return 1`;

/** For a name nobody could look up. */
export const UNSEEN: Presence = { online: false, lastSeenAt: null };
