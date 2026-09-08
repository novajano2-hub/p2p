import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { RedisModule } from "@/infra/redis/redis.module";
import { AuthController } from "@/modules/auth/auth.controller";
import { AuthService } from "@/modules/auth/auth.service";
import { SessionGuard } from "@/modules/auth/session.guard";
import { SessionService } from "@/modules/auth/session.service";

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [AuthController],
  providers: [AuthService, SessionService, SessionGuard],
  // Every module that guards a route needs these, so they are exported rather
  // than re-provided (which would give each module its own instance).
  exports: [SessionService, SessionGuard],
})
export class AuthModule {}
