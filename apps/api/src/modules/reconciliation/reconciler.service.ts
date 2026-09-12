import {
  type ReconciliationBreaksResponse,
  type ReconciliationBreakView,
  type ReconciliationPosition,
  type ReconciliationReport,
} from "@abay/contracts";
import { type BreakKind, type ReconciliationBreak } from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { AppError } from "@/common/errors/app-error";
import { toLedgerUnits } from "@/common/money/units";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import {
  BLOCKCHAIN_GATEWAY,
  type BlockchainGateway,
} from "@/modules/blockchain/blockchain.gateway";
import { chainConfig, type ChainConfig } from "@/modules/blockchain/chain-config";
import { CUSTODY_PROVIDER, type CustodyProvider } from "@/modules/custody/custody.provider";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";

/*
  The reconciler: does the chain hold what the ledger says it holds?

  This is invariant L9, and it is the only check in the system that looks
  outside the database. Everything else - balanced entries, balances equal to
  a rebuild, no negative customer balance - is internally consistent by
  construction. None of it would notice if the coins were simply gone.

  It is READ-ONLY, and that is a decision rather than an omission (ADR-0009).
  A difference has two possible meanings and they are opposites: a surplus is
  money we may owe somebody, a shortfall is a loss. Software cannot tell them
  apart, and a reconciler that posted its own correcting entry would be a
  program that can quietly create or destroy money whenever it is confused -
  which is the one thing this whole design exists to prevent. So it raises a
  break, and a person resolves it with a reason recorded.
*/

/** Where the chain can be asked about a ledger account. IN_TRANSIT has no address to ask. */
interface Position {
  accountCode: string;
  describes: string;
  addresses: string[];
}

@Injectable()
export class ReconcilerService {
  private readonly chain: ChainConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    @Inject(BLOCKCHAIN_GATEWAY) private readonly gateway: BlockchainGateway,
    @Inject(CUSTODY_PROVIDER) private readonly custody: CustodyProvider,
    @Inject(ENV) env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.chain = chainConfig(env);
    this.logger.setContext(ReconcilerService.name);
  }

  /*
    One pass. Every position the chain can be asked about is compared, a
    break is raised or refreshed for each difference, and the whole thing is
    returned so a person can see the arithmetic. Nothing is posted.
  */
  async reconcile(correlationId = `reconcile:${Date.now()}`): Promise<ReconciliationReport> {
    const positions = await this.positions();
    const results: ReconciliationPosition[] = [];
    let chainAssets = 0n;
    let breaksOpen = 0;

    for (const position of positions) {
      const [ledgerBalance, chainBalance] = await Promise.all([
        this.ledger.balance(position.accountCode),
        this.chainTotal(position.addresses),
      ]);
      chainAssets += chainBalance;
      const difference = chainBalance - ledgerBalance;
      const agrees =
        (difference < 0n ? -difference : difference) <= this.chain.reconciliation.tolerance;

      results.push({
        accountCode: position.accountCode,
        ledgerBalance: ledgerBalance.toString(),
        chainBalance: chainBalance.toString(),
        difference: difference.toString(),
        describes: position.describes,
        agrees,
      });

      if (agrees) continue;
      breaksOpen += 1;
      await this.raise({
        accountCode: position.accountCode,
        kind: difference > 0n ? "SURPLUS" : "SHORTFALL",
        ledgerBalance,
        chainBalance,
        difference: difference > 0n ? difference : -difference,
        describes: position.describes,
        addresses: position.addresses.length,
        correlationId,
      });
    }

    const inTransit = await this.ledger.balance(accounts.platform("IN_TRANSIT"));
    const ledgerAssets =
      results.reduce((sum, row) => sum + BigInt(row.ledgerBalance), 0n) + inTransit;

    return {
      checkedAt: new Date().toISOString(),
      network: this.chain.network,
      agrees: breaksOpen === 0,
      positions: results,
      breaksOpen,
      ledgerAssets: ledgerAssets.toString(),
      chainAssets: chainAssets.toString(),
      inTransit: inTransit.toString(),
    };
  }

  /** The three places our coins can sit where an address can be asked about them. */
  private async positions(): Promise<Position[]> {
    const [attribution, hot, cold] = await Promise.all([
      this.prisma.client.attributionAddress.findMany({
        where: { network: this.chain.network },
        select: { address: true },
      }),
      this.custody.treasuryAddress(this.chain.network, "HOT"),
      this.custody.treasuryAddress(this.chain.network, "COLD"),
    ]);
    return [
      {
        accountCode: accounts.platform("DEPOSIT_ADDRESSES"),
        describes: "every customer deposit address, before sweeping",
        addresses: attribution.map((row) => row.address),
      },
      {
        accountCode: accounts.platform("TREASURY_HOT"),
        describes: "the hot treasury wallet withdrawals are paid from",
        addresses: [hot],
      },
      {
        accountCode: accounts.platform("TREASURY_COLD"),
        describes: "the cold treasury wallet",
        addresses: [cold],
      },
    ];
  }

  /*
    A real chain cannot report a negative balance, and if ours ever does then
    something upstream is badly wrong. That is precisely a case for this
    service to report rather than to crash on: refusing to convert it would
    take the reconciler offline exactly when it is the only thing that could
    tell anybody. So the magnitude is converted and the sign put back, and
    the difference comes out as the enormous shortfall it would be.
  */
  private async chainTotal(addresses: readonly string[]): Promise<bigint> {
    let total = 0n;
    for (const address of addresses) {
      const raw = await this.gateway.tokenBalance(this.chain.network, address);
      total +=
        raw < 0n
          ? -toLedgerUnits(-raw, this.chain.token.decimals)
          : toLedgerUnits(raw, this.chain.token.decimals);
    }
    return total;
  }

  /*
    Raise a break, or refresh the one already open for this account. One open
    break per account, enforced by a partial unique index: a difference that
    persists is the same problem seen again, not a new one every minute. A
    break is never closed by this code, even if the difference goes away on
    its own - money that appears and disappears is more alarming than money
    that merely appears, and a person should see it either way.
  */
  private async raise(input: {
    accountCode: string;
    kind: BreakKind;
    ledgerBalance: bigint;
    chainBalance: bigint;
    difference: bigint;
    describes: string;
    addresses: number;
    correlationId: string;
  }): Promise<void> {
    const evidence = {
      describes: input.describes,
      addressesCompared: input.addresses,
      ledgerBalance: input.ledgerBalance.toString(),
      chainBalance: input.chainBalance.toString(),
      tolerance: this.chain.reconciliation.tolerance.toString(),
    };
    const existing = await this.prisma.client.reconciliationBreak.findFirst({
      where: { accountCode: input.accountCode, status: "OPEN" },
    });

    if (existing) {
      await this.prisma.client.reconciliationBreak.update({
        where: { id: existing.id },
        data: {
          kind: input.kind,
          ledgerBalance: input.ledgerBalance,
          chainBalance: input.chainBalance,
          difference: input.difference,
          evidence,
          lastSeenAt: new Date(),
        },
      });
      return;
    }

    const raised = await this.prisma.client.reconciliationBreak.create({
      data: {
        network: this.chain.network,
        asset: this.chain.token.symbol,
        accountCode: input.accountCode,
        kind: input.kind,
        ledgerBalance: input.ledgerBalance,
        chainBalance: input.chainBalance,
        difference: input.difference,
        evidence,
        correlationId: input.correlationId,
      },
    });
    /*
      The alert. Loud, because this is the one condition in the system that
      means the books and reality have parted company, and no amount of
      internal consistency will catch it.
    */
    this.logger.error(
      {
        event: "reconciliation.break",
        breakId: raised.id,
        accountCode: input.accountCode,
        kind: input.kind,
        difference: input.difference.toString(),
        correlationId: input.correlationId,
      },
      `reconciliation break: the chain holds ${input.kind === "SURPLUS" ? "more" : "less"} than the ledger says`,
    );
  }

  /* ---------------------------------------------------------------- read */

  async breaks(status?: "OPEN" | "RESOLVED" | "DISMISSED"): Promise<ReconciliationBreaksResponse> {
    const [rows, open] = await Promise.all([
      this.prisma.client.reconciliationBreak.findMany({
        where: status ? { status } : {},
        orderBy: { detectedAt: "desc" },
        take: 200,
      }),
      this.prisma.client.reconciliationBreak.count({ where: { status: "OPEN" } }),
    ]);
    return { breaks: rows.map(toBreakView), open };
  }

  async getBreak(id: string): Promise<ReconciliationBreakView> {
    const row = await this.prisma.client.reconciliationBreak.findUnique({ where: { id } });
    if (!row) throw AppError.notFound("There is no such reconciliation break.");
    return toBreakView(row);
  }
}

export function toBreakView(row: ReconciliationBreak): ReconciliationBreakView {
  return {
    id: row.id,
    network: row.network,
    asset: row.asset,
    accountCode: row.accountCode,
    kind: row.kind,
    status: row.status,
    ledgerBalance: row.ledgerBalance.toString(),
    chainBalance: row.chainBalance.toString(),
    difference: row.difference.toString(),
    detectedAt: row.detectedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionReason: row.resolutionReason,
    adjustmentTransactionId: row.adjustmentTransactionId,
    correlationId: row.correlationId,
  };
}
