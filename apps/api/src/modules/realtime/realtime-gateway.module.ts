import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { RedisModule } from "@/infra/redis/redis.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { RealtimeGateway } from "@/modules/realtime/realtime.gateway";
import { RealtimeModule } from "@/modules/realtime/realtime.module";

/** The socket server. HTTP application only: it attaches to the listening server. */
@Module({
  imports: [PrismaModule, RedisModule, AuthModule, RealtimeModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeGatewayModule {}
