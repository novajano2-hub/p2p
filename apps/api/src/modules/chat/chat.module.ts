import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { StorageModule } from "@/infra/storage/storage.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { ChatController } from "@/modules/chat/chat.controller";
import { ChatService } from "@/modules/chat/chat.service";
import { RealtimeModule } from "@/modules/realtime/realtime.module";

/** The trade chat. The service is exported for the disputes module, which reads transcripts. */
@Module({
  imports: [PrismaModule, StorageModule, AuthModule, RealtimeModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
