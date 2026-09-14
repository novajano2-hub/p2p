import { Module } from "@nestjs/common";

import { RedisModule } from "@/infra/redis/redis.module";
import { RealtimeService } from "@/modules/realtime/realtime.service";

/**
 * Publishing only. Any process may import this - the worker's expirer
 * publishes through it - which is why the socket server itself lives in
 * RealtimeGatewayModule, imported by the HTTP application alone.
 */
@Module({
  imports: [RedisModule],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
