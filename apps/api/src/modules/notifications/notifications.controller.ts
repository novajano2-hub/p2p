import { type NotificationsResponse } from "@abay/contracts";
import { Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";

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
  markRead(
    @Param("id", new ZodValidationPipe(idParam)) id: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<void> {
    return this.notifications.markRead(session.user.id, id);
  }

  @Post("read-all")
  @HttpCode(204)
  markAllRead(@CurrentSession() session: AuthenticatedSession): Promise<void> {
    return this.notifications.markAllRead(session.user.id);
  }
}
