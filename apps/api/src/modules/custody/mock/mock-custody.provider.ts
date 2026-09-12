import { createHash } from "node:crypto";

import { type ChainNetwork, type MockTransferOutcome } from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";

import { assertNoOpenTransaction } from "@/common/io/transaction-scope";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { chainConfig, type ChainConfig } from "@/modules/blockchain/chain-config";
import { MockChain } from "@/modules/blockchain/mock/mock-blockchain.gateway";
import {
  type CustodyProvider,
  type DepositAddress,
  type TransferOutcome,
  type TransferRequest,
  type TreasuryTier,
} from "@/modules/custody/custody.provider";

/*
  A custody provider that holds no keys and does what it is told (ADR-0006).

  Addresses are deterministic in the customer id, so the same customer always
  gets the same address and two runs of the suite agree. A transfer is
  idempotent on its client reference exactly as a real provider must be: the
  transaction hash is derived from the reference, so asking twice finds the
  transfer already on the chain and returns it rather than sending again.

  What it should do with a given reference can be directed ahead of time -
  refuse, or answer "unknown" with or without actually sending - which is how
  AT-9's ambiguous broadcast is staged. Undirected, it broadcasts.
*/

const fakeAddress = (seed: string): string =>
  `0x${createHash("sha256").update(seed).digest("hex").slice(0, 40)}`;

@Injectable()
export class MockCustodyProvider implements CustodyProvider {
  private readonly chain: ChainConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mockChain: MockChain,
    @Inject(ENV) env: Env,
  ) {
    this.chain = chainConfig(env);
  }

  createDepositAddress(input: { userId: string; network: ChainNetwork }): Promise<DepositAddress> {
    assertNoOpenTransaction("calling the custody provider");
    return Promise.resolve({
      address: fakeAddress(`address:${input.network}:${input.userId}`),
      walletRef: `mock-wallet-${input.network.toLowerCase()}`,
      accountRef: `mock-account-${input.userId}`,
    });
  }

  treasuryAddress(network: ChainNetwork, tier: TreasuryTier): Promise<string> {
    return Promise.resolve(fakeAddress(`treasury:${network}:${tier}`));
  }

  async transfer(request: TransferRequest): Promise<TransferOutcome> {
    assertNoOpenTransaction("calling the custody provider");
    const directive = await this.prisma.client.mockCustodyDirective.findUnique({
      where: { clientRef: request.clientRef },
    });
    const outcome: MockTransferOutcome = directive?.outcome ?? "BROADCAST";
    if (outcome === "REFUSED") return { kind: "REFUSED", reason: "refused by policy (directed)" };
    if (outcome === "UNKNOWN_DROPPED") return { kind: "UNKNOWN", providerRef: null };

    const txHash = `0x${createHash("sha256").update(`transfer:${request.clientRef}`).digest("hex")}`;
    const from =
      "treasury" in request.from
        ? await this.treasuryAddress(request.network, request.from.treasury)
        : request.from.address;
    const existing = await this.prisma.client.mockChainTransfer.findUnique({
      where: { network_txHash_logIndex: { network: request.network, txHash, logIndex: 0 } },
    });
    if (!existing) {
      await this.mockChain.mint({
        to: request.to,
        from,
        rawAmount: request.rawAmount,
        txHash,
        logIndex: 0,
        tokenContract: this.chain.token.contract,
        tag: `custody:${request.clientRef}`,
      });
    }
    const providerRef = `mock-${request.clientRef}`;
    if (outcome === "UNKNOWN_BROADCAST") return { kind: "UNKNOWN", providerRef };
    return { kind: "BROADCAST", txHash, providerRef };
  }

  /** Stage what the next transfer with this reference should do. Tests only. */
  async direct(clientRef: string, outcome: MockTransferOutcome): Promise<void> {
    await this.prisma.client.mockCustodyDirective.upsert({
      where: { clientRef },
      create: { clientRef, outcome },
      update: { outcome },
    });
  }
}
