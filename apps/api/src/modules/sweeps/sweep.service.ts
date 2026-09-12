import { type SweepView } from "@abay/contracts";
import { type Sweep } from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { v7 as uuidv7 } from "uuid";

import { toChainUnits } from "@/common/money/units";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { AuditService } from "@/modules/audit/audit.service";
import {
  BLOCKCHAIN_GATEWAY,
  type BlockchainGateway,
} from "@/modules/blockchain/blockchain.gateway";
import { chainConfig, type ChainConfig } from "@/modules/blockchain/chain-config";
import { CUSTODY_PROVIDER, type CustodyProvider } from "@/modules/custody/custody.provider";
import { confirmationsOf } from "@/modules/deposits/deposit.machine";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";

/*
  Sweeping: moving what customers deposited out of their individual addresses
  and into the pooled treasury (ADR-0002, JE-2).

  Nothing here touches a liability. Sweeping changes where coins sit, never
  who owns them - a customer's balance is the same before and after, and they
  are never told about it because it is not about them. It is also what makes
  withdrawals possible at all: a customer's balance is mostly not sitting at
  "their" address, because trading moves balances without moving coins, so
  paying anybody out means paying from a pool.

  What may be swept from an address is deliberately not "whatever the chain
  shows there". It is what the ledger already recognises: deposits that were
  credited (or booked as unidentified), less whatever has already been swept.
  A transfer still confirming is not ours to move yet, and anything else the
  chain shows is a reconciliation break rather than a windfall to sweep.
*/

const SUBJECT = "sweep";

interface Sweepable {
  addressId: string;
  address: string;
  amount: bigint;
}

@Injectable()
export class SweepService {
  private readonly chain: ChainConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    @Inject(BLOCKCHAIN_GATEWAY) private readonly gateway: BlockchainGateway,
    @Inject(CUSTODY_PROVIDER) private readonly custody: CustodyProvider,
    @Inject(ENV) env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.chain = chainConfig(env);
    this.logger.setContext(SweepService.name);
  }

  /*
    What each address holds that the ledger recognises and no sweep has yet
    claimed. One query rather than a loop: the deposits at an address that
    reached the ledger, less the sweeps out of it that are alive.
  */
  async sweepable(): Promise<Sweepable[]> {
    const rows = await this.prisma.client.$queryRaw<
      { address_id: string; address: string; amount: bigint }[]
    >`
      SELECT a.id AS address_id,
             a.address,
             (coalesce(d.credited, 0) - coalesce(s.swept, 0))::bigint AS amount
        FROM attribution_addresses a
        LEFT JOIN (
          SELECT address_id, sum(amount) AS credited
            FROM deposits
           WHERE address_id IS NOT NULL
             AND status IN ('CREDITED', 'UNATTRIBUTED')
             AND ledger_transaction_id IS NOT NULL
           GROUP BY address_id
        ) d ON d.address_id = a.id
        LEFT JOIN (
          SELECT address_id, sum(amount) AS swept
            FROM sweeps
           WHERE status IN ('PENDING', 'BROADCAST', 'CONFIRMED')
           GROUP BY address_id
        ) s ON s.address_id = a.id
       WHERE a.network = ${this.chain.network}::chain_network
         AND (coalesce(d.credited, 0) - coalesce(s.swept, 0)) > 0
       ORDER BY amount DESC`;
    return rows.map((row) => ({
      addressId: row.address_id,
      address: row.address,
      amount: row.amount,
    }));
  }

  /** Everything waiting at attribution addresses, in millionths. */
  async unswept(): Promise<bigint> {
    const rows = await this.sweepable();
    return rows.reduce((sum, row) => sum + row.amount, 0n);
  }

  /** One pass: sweep every address holding more than it is worth leaving there. */
  async sweepDue(limit = 20): Promise<{ swept: number; failed: number }> {
    const candidates = (await this.sweepable())
      .filter((row) => row.amount >= this.chain.sweep.minimum)
      .slice(0, limit);

    const tally = { swept: 0, failed: 0 };
    for (const candidate of candidates) {
      const outcome = await this.sweepOne(candidate);
      if (outcome === "broadcast") tally.swept += 1;
      else if (outcome === "failed") tally.failed += 1;
    }
    return tally;
  }

  private async sweepOne(candidate: Sweepable): Promise<"broadcast" | "failed" | "skipped"> {
    const id = uuidv7();
    const correlationId = `sweep:${id}`;

    // The row first, so that the amount is claimed before anything is asked of
    // the provider: a second pass computing sweepable() will not count it again.
    const claimed = await this.prisma.client.sweep.create({
      data: {
        id,
        addressId: candidate.addressId,
        network: this.chain.network,
        asset: this.chain.token.symbol,
        amount: candidate.amount,
        status: "PENDING",
        attempts: 1,
        correlationId,
      },
    });

    // Outside any transaction (AT-19).
    let outcome;
    try {
      outcome = await this.custody.transfer({
        clientRef: `sweep:${id}`,
        network: this.chain.network,
        asset: this.chain.token.symbol,
        from: { address: candidate.address },
        to: await this.custody.treasuryAddress(this.chain.network, "HOT"),
        rawAmount: toChainUnits(claimed.amount, this.chain.token.decimals),
      });
    } catch (error) {
      outcome = { kind: "UNKNOWN" as const, providerRef: null };
      this.logger.warn(
        { event: "sweep.transfer_threw", err: error, sweepId: id },
        "the sweep transfer failed with an unknown outcome",
      );
    }

    if (outcome.kind === "BROADCAST") {
      await this.prisma.transaction("sweep:broadcast", async (tx) => {
        // JE-2a. No liability account appears: this changes where the coins
        // sit, not who owns them.
        const posted = await this.ledger.postIn(tx, {
          reason: "SWEEP_BROADCAST",
          asset: "USDT",
          reference: { type: SUBJECT, id },
          actor: { type: "SYSTEM" },
          correlationId,
          idempotencyKey: `sweep:${id}:broadcast`,
          lines: [
            {
              account: accounts.platform("IN_TRANSIT"),
              direction: "DEBIT",
              amount: claimed.amount,
            },
            {
              account: accounts.platform("DEPOSIT_ADDRESSES"),
              direction: "CREDIT",
              amount: claimed.amount,
            },
          ],
        });
        await tx.sweep.update({
          where: { id },
          data: {
            status: "BROADCAST",
            txHash: outcome.kind === "BROADCAST" ? outcome.txHash.toLowerCase() : null,
            providerRef: outcome.kind === "BROADCAST" ? outcome.providerRef : null,
            broadcastTransactionId: posted.id,
          },
        });
        await this.audit.record(
          {
            action: "sweep.broadcast",
            actor: null,
            subject: { type: SUBJECT, id },
            after: { amount: claimed.amount.toString(), address: candidate.address },
            correlationId,
          },
          tx,
        );
      });
      return "broadcast";
    }

    /*
      Not broadcast, and the two reasons are not the same reason.

      REFUSED is certain: nothing moved, so the row is FAILED and the amount
      becomes sweepable again on the next pass, which is a safe retry.

      UNKNOWN is the ambiguous case, and the same rule applies here as to a
      withdrawal (AT-9): a retry would mint a new client reference and could
      move the coins a second time. So the row stays PENDING, which keeps the
      amount claimed and out of every later pass, and it waits for a person.
      The coins are ours either way - this is treasury, not a customer's
      balance - and the reconciler is what surfaces where they actually are.
    */
    const refused = outcome.kind === "REFUSED";
    const reason =
      outcome.kind === "REFUSED" ? outcome.reason : "the provider could not confirm the transfer";
    await this.prisma.client.sweep.update({
      where: { id },
      data: { status: refused ? "FAILED" : "PENDING", lastError: reason },
    });
    this.logger[refused ? "warn" : "error"](
      { event: refused ? "sweep.refused" : "sweep.unknown", sweepId: id, reason },
      refused
        ? "a sweep was refused and will be retried"
        : "a sweep needs a person: outcome unknown",
    );
    return "failed";
  }

  /** One pass of the sweep confirmer: every broadcast sweep against the chain. */
  async confirmSweeps(limit = 50): Promise<{ confirmed: number }> {
    const head = await this.gateway.headBlock(this.chain.network);
    const due = await this.prisma.client.sweep.findMany({
      where: { status: "BROADCAST", network: this.chain.network },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true },
    });
    let confirmed = 0;
    for (const { id } of due) if (await this.confirmOne(id, head)) confirmed += 1;
    return { confirmed };
  }

  private async confirmOne(id: string, head: bigint): Promise<boolean> {
    const sweep = await this.prisma.client.sweep.findUnique({ where: { id } });
    if (sweep?.status !== "BROADCAST" || !sweep.txHash) return false;

    const transfer = await this.gateway.findTransfer(sweep.network, sweep.txHash, 0);
    if (!transfer) return false;
    if (confirmationsOf(head, transfer.blockNumber) < this.chain.finality.confirmations)
      return false;

    return this.prisma.transaction("sweep:confirm", async (tx) => {
      const rows = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM sweeps WHERE id = ${id} FOR UPDATE`;
      if (rows[0]?.status !== "BROADCAST") return false;

      /*
        JE-2b. The gas variant (JE-2b') would put the difference into
        NETWORK_FEES here; on this network the platform pays gas in BNB, not
        out of the transferred USDT, so the amount that arrives is the amount
        that left. If that ever stops being true, this is the one place it
        changes.
      */
      const posted = await this.ledger.postIn(tx, {
        reason: "SWEEP_CONFIRMED",
        asset: "USDT",
        reference: { type: SUBJECT, id },
        actor: { type: "SYSTEM" },
        correlationId: sweep.correlationId,
        idempotencyKey: `sweep:${id}:confirm`,
        lines: [
          { account: accounts.platform("TREASURY_HOT"), direction: "DEBIT", amount: sweep.amount },
          { account: accounts.platform("IN_TRANSIT"), direction: "CREDIT", amount: sweep.amount },
        ],
      });
      await tx.sweep.update({
        where: { id },
        data: { status: "CONFIRMED", confirmedTransactionId: posted.id },
      });
      await this.audit.record(
        {
          action: "sweep.confirmed",
          actor: null,
          subject: { type: SUBJECT, id },
          after: { amount: sweep.amount.toString(), confirmedTransactionId: posted.id },
          correlationId: sweep.correlationId,
        },
        tx,
      );
      return true;
    });
  }

  /* ---------------------------------------------------------------- read */

  async list(limit = 100): Promise<SweepView[]> {
    const rows = await this.prisma.client.sweep.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { address: { select: { address: true } } },
    });
    return rows.map((row) => this.toView(row, row.address.address));
  }

  private toView(row: Sweep, address: string): SweepView {
    return {
      id: row.id,
      network: row.network,
      asset: row.asset,
      amount: row.amount.toString(),
      status: row.status,
      address,
      txHash: row.txHash,
      attempts: row.attempts,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
