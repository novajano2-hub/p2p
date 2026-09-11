import { type NotificationsResponse } from "@abay/contracts";
import { Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { RateLimit, minutes, perSession } from "@/common/rate-limit/rate-limit.policy";
import { ZodValidationPipe } from "@/common/validation/zod-validation.pipe";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { type AuthenticatedSession } from "@/modules/auth/session.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";

const idParam = z.uuid();

/** The customer's own notifications. Nothing here is reachable about anyone else's. */
@Controller("notifications")
@UseGuards(SessionGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentSession() session: AuthenticatedSession): Promise<NotificationsResponse> {
    return this.notifications.list(session.user.id);
  }

  @Post(":id/read")
  @HttpCode(204)
  /*
    Both writes are limited, and the list above deliberately is not. Marking
    something read is a database write a loop could repeat; reading the list is
    what every page load does, and making that depend on Redis would turn a
    cache outage into an outage.
  */
  @RateLimit(perSession(120, minutes(5)))
  markRead(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<void> {
    return this.notifications.markRead(session.user.id, id);
  }

  @Post("read-all")
  @HttpCode(204)
  @RateLimit(perSession(30, minutes(5)))
  markAllRead(@CurrentSession() session: AuthenticatedSession): Promise<void> {
    return this.notifications.markAllRead(session.user.id);
  }
}
