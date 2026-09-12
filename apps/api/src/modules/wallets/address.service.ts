import { Prisma, type AttributionAddress, type ChainNetwork } from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";

import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { RedisService } from "@/infra/redis/redis.service";
import { chainConfig, type ChainConfig } from "@/modules/blockchain/chain-config";
import { CUSTODY_PROVIDER, type CustodyProvider } from "@/modules/custody/custody.provider";

/*
  A customer's deposit address (ADR-0002): issued by the custody provider the
  first time it is asked for, then the same one for good.

  Two things happen in a fixed order and cannot share a transaction: the
  provider is asked (network I/O, AT-19), then the row is written. The unique
  index on (user, network, asset) is what makes two first requests at once
  safe - one insert wins, the other finds the winner's row. The Redis lock
  in front of that is a courtesy to the provider, so the ordinary race asks
  it once rather than twice; if the lock cannot be taken, the index still
  settles it.
*/

const LOCK_TTL_MS = 10_000;

@Injectable()
export class AddressService {
  private readonly chain: ChainConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(CUSTODY_PROVIDER) private readonly custody: CustodyProvider,
    @Inject(ENV) env: Env,
  ) {
    this.chain = chainConfig(env);
  }

  async getOrCreate(userId: string): Promise<AttributionAddress> {
    const network = this.chain.network;
    const asset = this.chain.token.symbol;
    const existing = await this.find(userId);
    if (existing) return existing;

    const lockKey = `address:create:${network}:${userId}`;
    const locked = await this.redis.client
      .set(lockKey, "1", "PX", LOCK_TTL_MS, "NX")
      .then((reply) => reply === "OK")
      .catch(() => false);
    if (!locked) {
      // Somebody else is asking the provider for this customer right now.
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const row = await this.find(userId);
        if (row) return row;
      }
    }

    try {
      const issued = await this.custody.createDepositAddress({ userId, network, asset });
      try {
        return await this.prisma.client.attributionAddress.create({
          data: {
            userId,
            network,
            asset,
            address: issued.address.toLowerCase(),
            custodyWalletRef: issued.walletRef,
            custodyAccountRef: issued.accountRef ?? null,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const row = await this.find(userId);
          if (row) return row;
        }
        throw error;
      }
    } finally {
      if (locked) await this.redis.client.del(lockKey).catch(() => undefined);
    }
  }

  /** Every address of ours on the network, retired ones included: money can still arrive there. */
  async all(network: ChainNetwork): Promise<string[]> {
    const rows = await this.prisma.client.attributionAddress.findMany({
      where: { network },
      select: { address: true },
    });
    return rows.map((row) => row.address);
  }

  private find(userId: string): Promise<AttributionAddress | null> {
    return this.prisma.client.attributionAddress.findUnique({
      where: {
        userId_network_asset: {
          userId,
          network: this.chain.network,
          asset: this.chain.token.symbol,
        },
      },
    });
  }
}
