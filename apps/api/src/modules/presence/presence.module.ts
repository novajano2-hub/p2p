import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { RedisModule } from "@/infra/redis/redis.module";
import { PresenceService } from "@/modules/presence/presence.service";

/**
 * Who is around. The socket server writes it; the marketplace and the trade
 * views read it. Its own module because both sides import it and neither
 * should import the other.
 */
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
