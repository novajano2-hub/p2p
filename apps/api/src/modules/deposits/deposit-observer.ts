import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { RedisService } from "@/infra/redis/redis.service";
import {
  BLOCKCHAIN_GATEWAY,
  type BlockchainGateway,
} from "@/modules/blockchain/blockchain.gateway";
import { chainConfig, type ChainConfig } from "@/modules/blockchain/chain-config";
import { DepositService } from "@/modules/deposits/deposit.service";
import { AddressService } from "@/modules/wallets/address.service";

/*
  The chain observer (overview.md, "worker processes"): scans the chain for
  transfers into any address of ours, so that a deposit is found whether or
  not the provider's webhook ever arrives. Rescans overlap the last pass by
  the reorg depth - a transfer indexed late is still found - and that is
  safe because recording is idempotent on the transfer itself.
*/

const INTERVAL_MS = 5_000;
const LOCK_KEY = "deposits:observe";
const LOCK_TTL_MS = 60_000;

@Injectable()
export class DepositObserver implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly chain: ChainConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly deposits: DepositService,
    private readonly addresses: AddressService,
    @Inject(BLOCKCHAIN_GATEWAY) private readonly gateway: BlockchainGateway,
    @Inject(ENV) env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.chain = chainConfig(env);
    this.logger.setContext(DepositObserver.name);
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const acquired = await this.redis.client.set(LOCK_KEY, "1", "PX", LOCK_TTL_MS, "NX");
      if (acquired !== "OK") return;
      await this.pass();
    } catch (error) {
      this.logger.warn(
        { event: "deposits.observe_failed", err: error },
        "the observer pass did not run",
      );
    } finally {
      this.running = false;
    }
  }

  /** One scan from just behind the last cursor to the head. Returns what it found. */
  async pass(): Promise<{ scanned: number; recorded: number; head: bigint }> {
    const network = this.chain.network;
    const head = await this.gateway.headBlock(network);
    const cursor = await this.prisma.client.chainObserverCursor.findUnique({ where: { network } });
    const overlap = BigInt(this.chain.finality.reorgDepth);
    const from = cursor && cursor.lastBlock > overlap ? cursor.lastBlock - overlap : 0n;

    const addresses = await this.addresses.all(network);
    const transfers =
      addresses.length === 0 ? [] : await this.gateway.transfersTo(network, addresses, from);

    let recorded = 0;
    for (const transfer of transfers) {
      const result = await this.deposits.ingest({
        network,
        txHash: transfer.txHash,
        logIndex: transfer.logIndex,
        via: "observer",
        correlationId: `observer:${transfer.txHash}:${transfer.logIndex}`,
      });
      if (result.outcome === "recorded") recorded += 1;
    }

    await this.prisma.client.chainObserverCursor.upsert({
      where: { network },
      create: { network, lastBlock: head },
      update: { lastBlock: head },
    });
    return { scanned: transfers.length, recorded, head };
  }
}
