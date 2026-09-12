import { createHash } from "node:crypto";

import { type ChainNetwork, type MockChainTransfer } from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";

import { assertNoOpenTransaction } from "@/common/io/transaction-scope";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { normalizeAddress } from "@/modules/blockchain/address";
import {
  type BlockchainGateway,
  type ChainTransfer,
} from "@/modules/blockchain/blockchain.gateway";
import { chainConfig, type ChainConfig } from "@/modules/blockchain/chain-config";

/*
  A chain that does exactly what it is told (ADR-0006).

  Postgres-backed so that the API, the worker and the test suite share one
  chain rather than each imagining its own. The gateway half is what domain
  code sees and is read-only, like the real thing will be; the MockChain half
  is the control surface - mint a transfer, advance blocks, reorg one away -
  which only tests and the development seed ever hold. Nothing in a deposit
  or withdrawal can reach it, which is the point: the domain must work
  against the chain it is given.
*/

const toTransfer = (row: MockChainTransfer): ChainTransfer => ({
  network: row.network,
  txHash: row.txHash,
  logIndex: row.logIndex,
  blockNumber: row.blockNumber,
  from: row.fromAddress,
  to: row.toAddress,
  tokenContract: row.tokenContract,
  rawAmount: BigInt(row.rawAmount),
});

@Injectable()
export class MockBlockchainGateway implements BlockchainGateway {
  constructor(private readonly prisma: PrismaService) {}

  async headBlock(network: ChainNetwork): Promise<bigint> {
    assertNoOpenTransaction("reading the chain");
    const head = await this.prisma.client.mockChainHead.findUnique({ where: { network } });
    return head?.height ?? 0n;
  }

  async findTransfer(
    network: ChainNetwork,
    txHash: string,
    logIndex: number,
  ): Promise<ChainTransfer | null> {
    assertNoOpenTransaction("reading the chain");
    const row = await this.prisma.client.mockChainTransfer.findUnique({
      where: { network_txHash_logIndex: { network, txHash: txHash.toLowerCase(), logIndex } },
    });
    return row?.orphanedAtBlock === null ? toTransfer(row) : null;
  }

  async transfersTo(
    network: ChainNetwork,
    addresses: readonly string[],
    fromBlock: bigint,
  ): Promise<ChainTransfer[]> {
    assertNoOpenTransaction("reading the chain");
    if (addresses.length === 0) return [];
    const rows = await this.prisma.client.mockChainTransfer.findMany({
      where: {
        network,
        toAddress: { in: addresses.map((a) => a.toLowerCase()) },
        blockNumber: { gte: fromBlock },
        orphanedAtBlock: null,
      },
      orderBy: [{ blockNumber: "asc" }, { txHash: "asc" }, { logIndex: "asc" }],
    });
    return rows.map(toTransfer);
  }

  async tokenBalance(network: ChainNetwork, address: string): Promise<bigint> {
    assertNoOpenTransaction("reading the chain");
    const who = address.toLowerCase();
    const rows = await this.prisma.client.$queryRaw<{ balance: string }[]>`
      SELECT (coalesce(sum(CASE WHEN to_address = ${who} THEN raw_amount::numeric ELSE 0 END), 0)
            - coalesce(sum(CASE WHEN from_address = ${who} THEN raw_amount::numeric ELSE 0 END), 0))::text AS balance
        FROM mock_chain_transfers
       WHERE network = ${network}::chain_network
         AND orphaned_at_block IS NULL
         AND (to_address = ${who} OR from_address = ${who})`;
    return BigInt(rows[0]?.balance ?? "0");
  }
}

export interface MintInput {
  to: string;
  rawAmount: bigint;
  from?: string | undefined;
  tokenContract?: string | undefined;
  txHash?: string | undefined;
  logIndex?: number | undefined;
  /** The test suite tags its rows so the teardown can find them. */
  tag?: string | undefined;
}

/** The hand on the mock chain. Held by tests and the development seed only. */
@Injectable()
export class MockChain {
  private readonly chain: ChainConfig;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) env: Env,
  ) {
    this.chain = chainConfig(env);
  }

  /** A new block holding one transfer. The head advances by one. */
  async mint(input: MintInput): Promise<ChainTransfer> {
    const network = this.chain.network;
    const txHash =
      input.txHash ?? `0x${createHash("sha256").update(`mint:${uuidv7()}`).digest("hex")}`;
    const row = await this.prisma.client.$transaction(async (tx) => {
      const head = await tx.mockChainHead.upsert({
        where: { network },
        create: { network, height: 1n },
        update: { height: { increment: 1n } },
      });
      return tx.mockChainTransfer.create({
        data: {
          network,
          txHash: txHash.toLowerCase(),
          logIndex: input.logIndex ?? 0,
          blockNumber: head.height,
          fromAddress: normalizeAddress(input.from ?? `0x${"0".repeat(40)}`),
          toAddress: normalizeAddress(input.to),
          tokenContract: (input.tokenContract ?? this.chain.token.contract).toLowerCase(),
          rawAmount: input.rawAmount.toString(),
          tag: input.tag ?? null,
        },
      });
    });
    return toTransfer(row);
  }

  /** Empty blocks: what confirmations are made of. */
  async advance(blocks: number): Promise<bigint> {
    const head = await this.prisma.client.mockChainHead.upsert({
      where: { network: this.chain.network },
      create: { network: this.chain.network, height: BigInt(blocks) },
      update: { height: { increment: BigInt(blocks) } },
    });
    return head.height;
  }

  /** The chain forgets a transfer, as a reorganisation would. */
  async reorg(txHash: string, logIndex = 0): Promise<void> {
    const head = await this.advance(1);
    await this.prisma.client.mockChainTransfer.update({
      where: {
        network_txHash_logIndex: {
          network: this.chain.network,
          txHash: txHash.toLowerCase(),
          logIndex,
        },
      },
      data: { orphanedAtBlock: head },
    });
  }

  async head(): Promise<bigint> {
    const head = await this.prisma.client.mockChainHead.findUnique({
      where: { network: this.chain.network },
    });
    return head?.height ?? 0n;
  }
}
