import { Module } from "@nestjs/common";

import { PrismaModule } from "@/infra/prisma/prisma.module";
import { RedisModule } from "@/infra/redis/redis.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { CustodyModule } from "@/modules/custody/custody.module";
import { AddressService } from "@/modules/wallets/address.service";
import { WalletController } from "@/modules/wallets/wallet.controller";

@Module({
  imports: [PrismaModule, RedisModule, AuthModule, CustodyModule],
  controllers: [WalletController],
  providers: [AddressService],
  exports: [AddressService],
})
export class WalletsModule {}
