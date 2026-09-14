import {
  type NotificationItem,
  type NotificationsResponse,
  type NotificationType,
} from "@abay/contracts";
import { type Notification, type Prisma } from "@abay/database";
import { Injectable } from "@nestjs/common";

import { AppError } from "@/common/errors/app-error";
import { afterCommit } from "@/common/io/transaction-scope";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { RealtimeService, topics } from "@/modules/realtime/realtime.service";

/*
  A customer's own notifications: what they were told, and whether they have
  read it. Nothing here is created by a customer's own request - the writers
  are the admin realm deciding a submission, and the deposit, withdrawal and
  trade engines - so the service a customer's session reaches is read-only
  except for marking something read.
*/

/** A Prisma client or an open transaction. The writer passes the transaction. */
type Writer = Pick<Prisma.TransactionClient, "notification">;

/** How many a bell realistically shows. Older ones are still fetchable; nothing deletes them. */
const LIST_LIMIT = 50;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(userId: string): Promise<NotificationsResponse> {
    const [notifications, unreadCount] = await Promise.all([
      this.prisma.client.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: LIST_LIMIT,
      }),
      this.prisma.client.notification.count({ where: { userId, readAt: null } }),
    ]);

    return { notifications: notifications.map(toItem), unreadCount };
  }

  /** Marks one as read. Scoped to its owner, so an id is never enough on its own. */
  async markRead(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.client.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    // Already read, or never this account's: either way there is nothing
    // left to do, and the two cases must look the same to the caller.
    if (count === 0) {
      const exists = await this.prisma.client.notification.findFirst({
        where: { id, userId },
        select: { id: true },
      });
      if (!exists) throw AppError.notFound("There is no such notification.");
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.client.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /**
   * Writes one. Pass the transaction when it belongs to a change being made
   * in one - a KYC decision and the notification telling the customer about
   * it commit together or neither does. The customer's open sockets hear of
   * it once it is durable, so a bell can ring without a refetch.
   */
  async notify(
    input: { userId: string; type: NotificationType; title: string; body: string; link?: string },
    tx?: Writer,
  ): Promise<void> {
    const writer = tx ?? this.prisma.client;
    const row = await writer.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
      },
    });
    await afterCommit(() =>
      this.realtime.publish({
        topics: [topics.user(input.userId)],
        frame: { type: "notification", notification: toItem(row) },
      }),
    );
  }
}

function toItem(row: Notification): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
