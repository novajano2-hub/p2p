import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";

import { MAILER, type Mailer } from "@/infra/mail/mailer";
import { OutboxService } from "@/modules/outbox/outbox.service";

/*
  The first thing the outbox carries: an email. A domain change that should
  tell somebody something enqueues one of these in its own transaction and
  never touches the mailer itself.

  Payload validated on the way out, not only on the way in: a row written by
  an older version of the code is still a row, and a malformed one should
  fail loudly here rather than reach the provider.
*/

export const EMAIL_EVENT = "email.send";

export const emailPayload = z.object({
  to: z.string().min(3),
  subject: z.string().min(1),
  text: z.string().min(1),
  html: z.string().min(1),
});
export type EmailPayload = z.infer<typeof emailPayload>;

@Injectable()
export class EmailHandler implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  onModuleInit(): void {
    this.outbox.register(EMAIL_EVENT, async (payload) => {
      await this.mailer.send(emailPayload.parse(payload));
    });
  }
}
