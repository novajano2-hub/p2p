import { custodyTransferWebhook, type WebhookAck } from "@abay/contracts";
import { Controller, HttpCode, Inject, Post, Req, type RawBodyRequest } from "@nestjs/common";
import { type FastifyRequest } from "fastify";
import { PinoLogger } from "nestjs-pino";

import { AppError } from "@/common/errors/app-error";
import { RateLimit, minutes, perIp } from "@/common/rate-limit/rate-limit.policy";
import { singleHeader } from "@/common/security/csrf";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import {
  verifyWebhook,
  WEBHOOK_SIGNATURE_HEADER,
} from "@/modules/custody/webhooks/webhook-signature";
import { DepositService } from "@/modules/deposits/deposit.service";

/*
  Where the custody provider tells us a transfer arrived (threat model B6).

  No session and no CSRF: the caller is a machine, and what stands in for
  its identity is the signature over the raw bytes, checked before the body
  is believed. What the body says is then only a pointer - which transfer -
  and the transfer itself is read from the chain, so a forged or mistaken
  webhook can at most make us look at the chain.

  Every well-signed delivery is answered 200, including the second, fifth
  and fiftieth copy of the same one: an error would have the provider retry
  until it gave up, and a duplicate is not an error (AT-1).
*/
@Controller("webhooks")
export class CustodyWebhookController {
  constructor(
    private readonly deposits: DepositService,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CustodyWebhookController.name);
  }

  @Post("custody")
  @HttpCode(200)
  // A provider delivers at most a few a minute; a flood is somebody else.
  @RateLimit(perIp(600, minutes(5)))
  async custody(@Req() request: RawBodyRequest<FastifyRequest>): Promise<WebhookAck> {
    const raw = request.rawBody;
    if (!raw) throw AppError.validation([{ path: "body", message: "A JSON body is required." }]);

    const verdict = verifyWebhook({
      secret: this.env.CUSTODY_WEBHOOK_SECRET,
      header: singleHeader(request.headers[WEBHOOK_SIGNATURE_HEADER]),
      rawBody: raw,
    });
    if (!verdict.ok) {
      this.logger.warn(
        { event: "webhook.refused", reason: verdict.reason },
        "custody webhook refused",
      );
      throw AppError.unauthenticated("The webhook signature is missing, stale or wrong.");
    }

    const parsed = custodyTransferWebhook.safeParse(request.body);
    if (!parsed.success) {
      throw AppError.validation(
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }

    const result = await this.deposits.ingest({
      network: parsed.data.network,
      txHash: parsed.data.txHash,
      logIndex: parsed.data.logIndex,
      via: "webhook",
      correlationId: request.id,
    });
    return { received: true, outcome: result.outcome };
  }
}
