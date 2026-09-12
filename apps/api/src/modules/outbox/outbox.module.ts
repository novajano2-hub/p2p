import { Module } from "@nestjs/common";

import { MailModule } from "@/infra/mail/mail.module";
import { PrismaModule } from "@/infra/prisma/prisma.module";
import { EmailHandler } from "@/modules/outbox/handlers/email.handler";
import { OutboxService } from "@/modules/outbox/outbox.service";

/*
  Enqueueing is available to every module that imports this; delivering is
  the worker's job, and the worker adds OutboxPublisher itself. The handlers
  are registered here too, in both processes, so that a handler's wiring is
  checked wherever the module loads and not only where it runs.
*/
@Module({
  imports: [PrismaModule, MailModule],
  providers: [OutboxService, EmailHandler],
  exports: [OutboxService],
})
export class OutboxModule {}
