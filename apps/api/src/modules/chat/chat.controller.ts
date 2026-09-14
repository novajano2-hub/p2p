import {
  clientMessageId,
  markReadRequest,
  messagesQuery,
  sendMessageRequest,
  type MarkReadRequest,
  type MessagesQuery,
  type MessagesResponse,
  type SendMessageRequest,
  type TradeMessageView,
} from "@abay/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { type FastifyReply } from "fastify";
import { z } from "zod";

import { AppError } from "@/common/errors/app-error";
import { RateLimit, hours, minutes, perSession } from "@/common/rate-limit/rate-limit.policy";
import { ZodValidationPipe, zodBody, zodQuery } from "@/common/validation/zod-validation.pipe";
import { CurrentSession, SessionGuard } from "@/modules/auth/session.guard";
import { type AuthenticatedSession } from "@/modules/auth/session.service";
import { ChatService } from "@/modules/chat/chat.service";

const idParam = z.uuid();

/**
 * The chat inside a trade. Sending is a POST rather than a socket frame on
 * purpose: it then carries the session, the CSRF token, the rate limit and
 * the idempotency key every other write does, and the socket stays a
 * delivery channel that decides nothing.
 */
@Controller("trades/:tradeId/messages")
@UseGuards(SessionGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(
    @Param("tradeId", new ZodValidationPipe(idParam)) tradeId: string,
    @Query(zodQuery(messagesQuery)) query: MessagesQuery,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<MessagesResponse> {
    return this.chat.list(session.user.id, tradeId, query);
  }

  @Post()
  @HttpCode(201)
  @RateLimit(perSession(60, minutes(1)))
  send(
    @Param("tradeId", new ZodValidationPipe(idParam)) tradeId: string,
    @Body(zodBody(sendMessageRequest)) body: SendMessageRequest,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<TradeMessageView> {
    return this.chat.send(session.user.id, tradeId, body);
  }

  /*
    An image, as the raw bytes under its own content type (the same parsers
    the identity documents use). The client's message id travels in the
    path, since there is no JSON body to carry it.
  */
  @Post("images/:clientMessageId")
  @HttpCode(201)
  @RateLimit(perSession(30, hours(1)))
  sendImage(
    @Param("tradeId", new ZodValidationPipe(idParam)) tradeId: string,
    @Param("clientMessageId", new ZodValidationPipe(clientMessageId)) messageId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<TradeMessageView> {
    if (!Buffer.isBuffer(body)) {
      throw AppError.validation(
        [{ path: "file", message: "Send the image itself as the request body." }],
        "Send the image as a JPEG, PNG or WebP.",
      );
    }
    return this.chat.sendImage(session.user.id, tradeId, messageId, body);
  }

  @Get(":messageId/image")
  @RateLimit(perSession(240, minutes(5)))
  async image(
    @Param("tradeId", new ZodValidationPipe(idParam)) tradeId: string,
    @Param("messageId", new ZodValidationPipe(idParam)) messageId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const found = await this.chat.image(session.user.id, tradeId, messageId);
    if (!found) throw AppError.notFound("That image is not available.");
    await reply.type(found.contentType).send(found.body);
  }

  @Post("read")
  @HttpCode(204)
  @RateLimit(perSession(120, minutes(5)))
  markRead(
    @Param("tradeId", new ZodValidationPipe(idParam)) tradeId: string,
    @Body(zodBody(markReadRequest)) body: MarkReadRequest,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<void> {
    return this.chat.markRead(session.user.id, tradeId, body.seq);
  }
}
