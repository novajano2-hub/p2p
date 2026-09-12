import {
  type AdminDepositItem,
  type AdminDepositQueueResponse,
  type DepositView,
} from "@abay/contracts";
import { type ChainNetwork, type Deposit } from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { v7 as uuidv7 } from "uuid";

import { AppError } from "@/common/errors/app-error";
import { formatUsdt, toLedgerUnits } from "@/common/money/units";
import { IllegalTransitionError } from "@/common/state-machine/transition";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { type AdminSessionContext } from "@/modules/admin/admin-session.service";
import { AuditService } from "@/modules/audit/audit.service";
import {
  BLOCKCHAIN_GATEWAY,
  type BlockchainGateway,
  type ChainTransfer,
} from "@/modules/blockchain/blockchain.gateway";
import { chainConfig, type ChainConfig } from "@/modules/blockchain/chain-config";
import { depositCreditedEmail } from "@/modules/deposits/deposit-mail";
import {
  assertDepositTransition,
  confirmationsOf,
  isOrphaned,
} from "@/modules/deposits/deposit.machine";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import { EMAIL_EVENT } from "@/modules/outbox/handlers/email.handler";
import { OutboxService } from "@/modules/outbox/outbox.service";
import { type DepositRiskVerdict, RISK_ENGINE, type RiskEngine } from "@/modules/risk/risk.engine";

/*
  Money coming in: the deposit state machine (state-machines.md 1).

  A deposit is first a claim - a webhook, or the observer's own scan - and
  becomes a fact only when the chain confirms it, twice: once at detection,
  when the transfer is re-read from the chain before a row exists, and once
  at credit, when it must still be on the canonical chain with enough blocks
  on top. Between those, the row records what the chain says and moves only
  along the table in deposit.machine.ts.

  Every transition that moves money does so inside one transaction with the
  row it moves: the row locked with FOR UPDATE, the ledger posted through
  LedgerService.postIn, the audit event and the customer's notification
  written beside them. That is what makes a repeated webhook, a second
  worker, or an administrator's double-click harmless (AT-1): the lock
  serialises them and the state check inside it sends the late one away.
  Nothing in here reaches the chain or the risk engine while holding that
  lock (AT-19): both are consulted first, then the transaction opens.
*/

const SUBJECT = "deposit";

export interface IngestInput {
  network: ChainNetwork;
  txHash: string;
  logIndex: number;
  via: "webhook" | "observer";
  correlationId: string;
}

export type IngestOutcome =
  | { outcome: "recorded"; deposit: Deposit }
  | { outcome: "duplicate"; deposit: Deposit }
  | { outcome: "not_on_chain" };

export type ConfirmOutcome = "waiting" | "credited" | "held" | "orphaned" | "skipped";

interface Context {
  correlationId: string;
  ip?: string | undefined;
}

type Decision =
  | { by: "system" }
  | { by: "admin"; session: AdminSessionContext; reason: string | null; context: Context };

type Classification =
  | { accept: true; addressId: string; userId: string }
  | { accept: false; reason: string; underControl: boolean; addressId: string | null };

type DepositWithUser = Deposit & { user: { id: string; email: string } | null };

const USER = { select: { id: true, email: true } } as const;

@Injectable()
export class DepositService {
  private readonly chain: ChainConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
    @Inject(BLOCKCHAIN_GATEWAY) private readonly gateway: BlockchainGateway,
    @Inject(RISK_ENGINE) private readonly risk: RiskEngine,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.chain = chainConfig(env);
    this.logger.setContext(DepositService.name);
  }

  /* ------------------------------------------------------------- detect */

  /**
   * A transfer has been claimed, by a webhook or by the observer. Verified
   * against the chain, recorded once, and classified: CONFIRMING when it is
   * the configured token, to a live address of ours, above dust, for an
   * active account; UNATTRIBUTED otherwise, with the coins booked to the
   * unidentified-deposits liability (JE-10a) when they are genuinely ours.
   */
  async ingest(input: IngestInput): Promise<IngestOutcome> {
    const txHash = input.txHash.toLowerCase();
    const existing = await this.findByTransfer(input.network, txHash, input.logIndex);
    if (existing) return { outcome: "duplicate", deposit: existing };

    const transfer = await this.gateway.findTransfer(input.network, txHash, input.logIndex);
    if (!transfer) {
      this.logger.warn(
        { event: "deposit.not_on_chain", txHash, logIndex: input.logIndex, via: input.via },
        "a transfer was claimed that the chain does not have",
      );
      return { outcome: "not_on_chain" };
    }
    const verdict = await this.classify(transfer);
    const amount = toLedgerUnits(transfer.rawAmount, this.chain.token.decimals);
    const id = uuidv7();

    const recorded = await this.prisma.transaction("deposit:ingest", async (tx) => {
      const inserted = await tx.$executeRaw`
        INSERT INTO deposits
          (id, network, tx_hash, log_index, block_number, from_address, to_address, token_contract,
           raw_amount, asset, amount, address_id, user_id, status, confirmations, correlation_id,
           detected_at, "updatedAt", detected_via)
        VALUES
          (${id}, ${transfer.network}::chain_network, ${txHash}, ${transfer.logIndex}, ${transfer.blockNumber},
           ${transfer.from}, ${transfer.to}, ${transfer.tokenContract}, ${transfer.rawAmount.toString()},
           'USDT'::ledger_asset, ${amount}, ${verdict.addressId}, ${verdict.accept ? verdict.userId : null},
           'DETECTED'::deposit_status, 0, ${input.correlationId}, now(), now(), ${input.via})
        ON CONFLICT (network, tx_hash, log_index) DO NOTHING`;
      if (inserted === 0) return null;

      await this.audit.record(
        {
          action: "deposit.detected",
          actor: null,
          subject: { type: SUBJECT, id },
          after: { txHash, logIndex: transfer.logIndex, via: input.via, amount: amount.toString() },
          correlationId: input.correlationId,
        },
        tx,
      );

      if (verdict.accept) {
        assertDepositTransition("DETECTED", "CONFIRMING");
        await tx.deposit.update({ where: { id }, data: { status: "CONFIRMING" } });
        await this.audit.record(
          {
            action: "deposit.confirming",
            actor: null,
            subject: { type: SUBJECT, id },
            after: { userId: verdict.userId },
            correlationId: input.correlationId,
          },
          tx,
        );
      } else {
        assertDepositTransition("DETECTED", "UNATTRIBUTED");
        let ledgerTransactionId: string | null = null;
        if (verdict.underControl && amount > 0n) {
          const posted = await this.ledger.postIn(tx, {
            reason: "UNIDENTIFIED_DEPOSIT_RECEIVED",
            asset: "USDT",
            reference: { type: SUBJECT, id },
            actor: { type: "SYSTEM" },
            correlationId: input.correlationId,
            idempotencyKey: `deposit:${id}:unidentified`,
            lines: [
              { account: accounts.platform("DEPOSIT_ADDRESSES"), direction: "DEBIT", amount },
              { account: accounts.platform("UNIDENTIFIED_DEPOSITS"), direction: "CREDIT", amount },
            ],
          });
          ledgerTransactionId = posted.id;
        }
        await tx.deposit.update({
          where: { id },
          data: { status: "UNATTRIBUTED", reviewReason: verdict.reason, ledgerTransactionId },
        });
        await this.audit.record(
          {
            action: "deposit.unattributed",
            actor: null,
            subject: { type: SUBJECT, id },
            reason: verdict.reason,
            after: { underControl: verdict.underControl, ledgerTransactionId },
            correlationId: input.correlationId,
          },
          tx,
        );
      }
      return tx.deposit.findUniqueOrThrow({ where: { id } });
    });

    if (!recorded) {
      // Lost the race to record it; the other one is now committed.
      const winner = await this.findByTransfer(input.network, txHash, input.logIndex);
      if (winner) return { outcome: "duplicate", deposit: winner };
      throw new Error("deposit: recorded by nobody after a conflict");
    }
    this.logger.info(
      { event: "deposit.recorded", depositId: id, status: recorded.status, via: input.via },
      "deposit recorded",
    );
    return { outcome: "recorded", deposit: recorded };
  }

  /* ------------------------------------------------------------ confirm */

  /** One pass of the confirmer: every CONFIRMING deposit against the chain's head. */
  async confirmDue(limit = 100): Promise<Record<ConfirmOutcome, number>> {
    const head = await this.gateway.headBlock(this.chain.network);
    const due = await this.prisma.client.deposit.findMany({
      where: { status: "CONFIRMING", network: this.chain.network },
      orderBy: { detectedAt: "asc" },
      take: limit,
      select: { id: true },
    });
    const tally: Record<ConfirmOutcome, number> = {
      waiting: 0,
      credited: 0,
      held: 0,
      orphaned: 0,
      skipped: 0,
    };
    for (const { id } of due) tally[await this.confirmOne(id, head)] += 1;
    return tally;
  }

  /*
    One deposit against the chain. The chain and the risk engine are asked
    before the transaction opens; inside it the row is locked and its state
    re-read, so that two confirmers, or a confirmer and an administrator,
    cannot both act on the same finding.
  */
  async confirmOne(id: string, head: bigint): Promise<ConfirmOutcome> {
    const deposit = await this.prisma.client.deposit.findUnique({
      where: { id },
      include: { user: USER },
    });
    if (deposit?.status !== "CONFIRMING") return "skipped";

    const transfer = await this.gateway.findTransfer(
      deposit.network,
      deposit.txHash,
      deposit.logIndex,
    );
    if (!transfer) {
      if (!isOrphaned(head, deposit.blockNumber, this.chain.finality.reorgDepth)) return "waiting";
      return this.prisma.transaction("deposit:orphan", async (tx) => {
        if ((await this.lock(tx, id)) !== "CONFIRMING") return "skipped";
        assertDepositTransition("CONFIRMING", "ORPHANED");
        await tx.deposit.update({
          where: { id },
          data: {
            status: "ORPHANED",
            reviewReason: `absent from the canonical chain at height ${head}`,
          },
        });
        await this.audit.record(
          {
            action: "deposit.orphaned",
            actor: null,
            subject: { type: SUBJECT, id },
            before: { status: "CONFIRMING" },
            after: {
              status: "ORPHANED",
              head: head.toString(),
              blockNumber: deposit.blockNumber.toString(),
            },
            correlationId: deposit.correlationId,
          },
          tx,
        );
        return "orphaned";
      });
    }

    const confirmations = confirmationsOf(head, transfer.blockNumber);
    if (confirmations < this.chain.finality.confirmations) {
      // Progress the customer can watch. A reorg may have re-included it in a later block.
      await this.prisma.client.deposit.updateMany({
        where: { id, status: "CONFIRMING" },
        data: { confirmations, blockNumber: transfer.blockNumber },
      });
      return "waiting";
    }

    // Finality. The risk engine is an adapter, so it is asked out here, and
    // an engine that cannot answer holds the deposit rather than crediting it.
    let verdict: DepositRiskVerdict;
    try {
      verdict = await this.risk.evaluateDeposit({
        userId: deposit.userId,
        amount: deposit.amount,
        from: deposit.fromAddress,
      });
    } catch (error) {
      this.logger.warn(
        { event: "deposit.risk_unavailable", err: error, depositId: id },
        "risk engine failed; holding",
      );
      verdict = { decision: "REVIEW", reasons: ["risk engine unavailable"] };
    }

    return this.prisma.transaction("deposit:credit", async (tx) => {
      if ((await this.lock(tx, id)) !== "CONFIRMING") return "skipped";
      if (verdict.decision === "REVIEW") {
        assertDepositTransition("CONFIRMING", "MANUAL_REVIEW");
        const reason = verdict.reasons.join("; ");
        await tx.deposit.update({
          where: { id },
          data: { status: "MANUAL_REVIEW", confirmations, reviewReason: reason },
        });
        await this.audit.record(
          {
            action: "deposit.held_for_review",
            actor: null,
            subject: { type: SUBJECT, id },
            reason,
            before: { status: "CONFIRMING" },
            after: { status: "MANUAL_REVIEW" },
            correlationId: deposit.correlationId,
          },
          tx,
        );
        return "held";
      }
      await this.credit(tx, { ...deposit, confirmations }, { by: "system" });
      return "credited";
    });
  }

  /* ------------------------------------------------------------- credit */

  /*
    JE-1, and everything that goes with it, in the caller's transaction: the
    row to CREDITED, the audit event, the customer's notification and the
    email through the outbox. The ledger key is the deposit id, so this can
    only ever post once for one deposit however it is reached (AT-1).
  */
  private async credit(
    tx: Parameters<LedgerService["postIn"]>[0],
    deposit: DepositWithUser,
    decision: Decision,
  ): Promise<void> {
    const userId = deposit.userId;
    if (!userId) throw new Error("deposit: cannot credit a deposit that has no owner");
    assertDepositTransition(deposit.status, "CREDITED");
    const admin = decision.by === "admin" ? decision : null;
    const correlationId = admin ? admin.context.correlationId : deposit.correlationId;

    const posted = await this.ledger.postIn(tx, {
      reason: "DEPOSIT_CREDITED",
      asset: "USDT",
      reference: { type: SUBJECT, id: deposit.id },
      actor: admin ? { type: "ADMIN", id: admin.session.admin.id } : { type: "SYSTEM" },
      correlationId,
      idempotencyKey: `deposit:${deposit.id}:credit`,
      lines: [
        {
          account: accounts.platform("DEPOSIT_ADDRESSES"),
          direction: "DEBIT",
          amount: deposit.amount,
        },
        { account: accounts.userAvailable(userId), direction: "CREDIT", amount: deposit.amount },
      ],
    });

    const now = new Date();
    await tx.deposit.update({
      where: { id: deposit.id },
      data: {
        status: "CREDITED",
        confirmations: deposit.confirmations,
        creditedAt: now,
        ledgerTransactionId: posted.id,
        ...(admin
          ? { decidedBy: admin.session.admin.id, decidedAt: now, decisionReason: admin.reason }
          : {}),
      },
    });
    await this.audit.record(
      {
        action: admin ? "deposit.credited.manual" : "deposit.credited",
        actor: admin ? { id: admin.session.admin.id, email: admin.session.admin.email } : null,
        subject: { type: SUBJECT, id: deposit.id },
        reason: admin?.reason ?? null,
        before: { status: deposit.status },
        after: { status: "CREDITED", userId, ledgerTransactionId: posted.id },
        correlationId,
        ip: admin?.context.ip ?? null,
      },
      tx,
    );
    await this.tell(tx, userId, deposit.user?.email ?? null, deposit.amount, correlationId);
  }

  /** The customer is told twice: a notification in the app, an email through the outbox. */
  private async tell(
    tx: Parameters<LedgerService["postIn"]>[0],
    userId: string,
    email: string | null,
    amount: bigint,
    correlationId: string,
  ): Promise<void> {
    await this.notifications.notify(
      {
        userId,
        type: "DEPOSIT_CREDITED",
        title: "Deposit received",
        body: `${formatUsdt(amount)} USDT is now in your available balance.`,
        link: "/wallet",
      },
      tx,
    );
    if (email) {
      await this.outbox.enqueue(tx, {
        type: EMAIL_EVENT,
        // Spread: an interface has no index signature, and the outbox stores JSON.
        payload: { ...depositCreditedEmail({ to: email, appName: this.env.APP_NAME, amount }) },
        correlationId,
      });
    }
  }

  /* ----------------------------------------------------------- helpers */

  /*
    Whether a transfer is a customer's deposit. Every "no" is a reason a
    person will read, and says whether the coins are ours to book: a wrong
    token is not USDT at all, and an address we never issued is not ours.
  */
  private async classify(transfer: ChainTransfer): Promise<Classification> {
    const tokenMatches = transfer.tokenContract === this.chain.token.contract;
    const address = await this.prisma.client.attributionAddress.findUnique({
      where: { network_address: { network: transfer.network, address: transfer.to } },
      include: { user: { select: { id: true, status: true } } },
    });
    const addressId = address?.id ?? null;
    const underControl = tokenMatches && address !== null;
    const refuse = (reason: string): Classification => ({
      accept: false,
      reason,
      underControl,
      addressId,
    });

    if (!tokenMatches) return refuse("token contract is not the configured USDT");
    if (!address) return refuse("destination is not an address we issued");
    if (address.status !== "ACTIVE") return refuse("destination address is retired");
    const amount = toLedgerUnits(transfer.rawAmount, this.chain.token.decimals);
    if (amount < this.chain.deposit.dust) return refuse("amount is below the dust threshold");
    if (address.user.status !== "ACTIVE") return refuse("the account is not active");
    return { accept: true, addressId: address.id, userId: address.user.id };
  }

  /** Locks the row for the rest of the transaction and returns its status as it is now. */
  private async lock(
    tx: Parameters<LedgerService["postIn"]>[0],
    id: string,
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM deposits WHERE id = ${id} FOR UPDATE`;
    return rows[0]?.status ?? null;
  }

  private findByTransfer(network: ChainNetwork, txHash: string, logIndex: number) {
    return this.prisma.client.deposit.findUnique({
      where: { network_txHash_logIndex: { network, txHash, logIndex } },
    });
  }

  /* ------------------------------------------------------------ decide */

  /**
   * An administrator decides a held deposit: approve credits it (JE-1, as
   * the system would have), reject parks it. Both are recorded with who and
   * why; rejecting demands the why.
   */
  async review(
    id: string,
    outcome: "APPROVE" | "REJECT",
    reason: string | null,
    session: AdminSessionContext,
    context: Context,
  ): Promise<AdminDepositItem> {
    const deposit = await this.prisma.client.deposit.findUnique({
      where: { id },
      include: { user: USER },
    });
    if (!deposit) throw AppError.notFound("There is no such deposit.");
    const to = outcome === "APPROVE" ? "CREDITED" : "REJECTED";
    if (deposit.status !== "MANUAL_REVIEW") {
      throw new IllegalTransitionError("deposit", deposit.status, to);
    }

    await this.prisma.transaction("deposit:review", async (tx) => {
      if ((await this.lock(tx, id)) !== "MANUAL_REVIEW") {
        throw AppError.conflict("This deposit was decided by someone else a moment ago.");
      }
      if (outcome === "APPROVE") {
        await this.credit(tx, deposit, { by: "admin", session, reason, context });
        return;
      }
      assertDepositTransition("MANUAL_REVIEW", "REJECTED");
      const now = new Date();
      await tx.deposit.update({
        where: { id },
        data: {
          status: "REJECTED",
          decidedBy: session.admin.id,
          decidedAt: now,
          decisionReason: reason,
        },
      });
      await this.audit.record(
        {
          action: "deposit.rejected",
          actor: { id: session.admin.id, email: session.admin.email },
          subject: { type: SUBJECT, id },
          reason,
          before: { status: "MANUAL_REVIEW" },
          after: { status: "REJECTED" },
          correlationId: context.correlationId,
          ip: context.ip ?? null,
        },
        tx,
      );
    });
    return this.adminItem(id);
  }

  /**
   * An administrator names the owner of an unattributed deposit. Only
   * possible when the coins are ours to give - JE-10a was posted at
   * detection - and then JE-10b moves them from the unidentified liability
   * to the customer's balance.
   */
  async attribute(
    id: string,
    userId: string,
    reason: string,
    session: AdminSessionContext,
    context: Context,
  ): Promise<AdminDepositItem> {
    const deposit = await this.prisma.client.deposit.findUnique({ where: { id } });
    if (!deposit) throw AppError.notFound("There is no such deposit.");
    if (deposit.status !== "UNATTRIBUTED") {
      throw new IllegalTransitionError("deposit", deposit.status, "CREDITED");
    }
    if (!deposit.ledgerTransactionId) {
      throw AppError.conflict(
        "This transfer never reached an address of ours, so there is nothing to attribute.",
      );
    }
    const target = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, status: true },
    });
    if (!target) throw AppError.notFound("There is no such customer.");
    if (target.status !== "ACTIVE") throw AppError.conflict("That account is not active.");

    await this.prisma.transaction("deposit:attribute", async (tx) => {
      if ((await this.lock(tx, id)) !== "UNATTRIBUTED") {
        throw AppError.conflict("This deposit was decided by someone else a moment ago.");
      }
      assertDepositTransition("UNATTRIBUTED", "CREDITED");
      const posted = await this.ledger.postIn(tx, {
        reason: "UNIDENTIFIED_DEPOSIT_ATTRIBUTED",
        asset: "USDT",
        reference: { type: SUBJECT, id },
        actor: { type: "ADMIN", id: session.admin.id },
        correlationId: context.correlationId,
        idempotencyKey: `deposit:${id}:attribute`,
        lines: [
          {
            account: accounts.platform("UNIDENTIFIED_DEPOSITS"),
            direction: "DEBIT",
            amount: deposit.amount,
          },
          {
            account: accounts.userAvailable(target.id),
            direction: "CREDIT",
            amount: deposit.amount,
          },
        ],
      });
      const now = new Date();
      await tx.deposit.update({
        where: { id },
        data: {
          status: "CREDITED",
          userId: target.id,
          creditedAt: now,
          ledgerTransactionId: posted.id,
          decidedBy: session.admin.id,
          decidedAt: now,
          decisionReason: reason,
        },
      });
      await this.audit.record(
        {
          action: "deposit.attributed",
          actor: { id: session.admin.id, email: session.admin.email },
          subject: { type: SUBJECT, id },
          reason,
          before: { status: "UNATTRIBUTED", userId: null },
          after: { status: "CREDITED", userId: target.id, ledgerTransactionId: posted.id },
          correlationId: context.correlationId,
          ip: context.ip ?? null,
        },
        tx,
      );
      await this.tell(tx, target.id, target.email, deposit.amount, context.correlationId);
    });
    return this.adminItem(id);
  }

  /* -------------------------------------------------------------- read */

  async listForUser(userId: string): Promise<DepositView[]> {
    const rows = await this.prisma.client.deposit.findMany({
      where: { userId },
      orderBy: { detectedAt: "desc" },
      take: 100,
    });
    return rows.map((row) => this.toView(row));
  }

  async getForUser(userId: string, id: string): Promise<DepositView> {
    const row = await this.prisma.client.deposit.findFirst({ where: { id, userId } });
    if (!row) throw AppError.notFound("There is no such deposit.");
    return this.toView(row);
  }

  /** What an administrator has to decide: held and unattributed, oldest first. */
  async queue(): Promise<AdminDepositQueueResponse> {
    const rows = await this.prisma.client.deposit.findMany({
      where: { status: { in: ["MANUAL_REVIEW", "UNATTRIBUTED"] } },
      orderBy: { detectedAt: "asc" },
      take: 200,
    });
    return { deposits: rows.map((row) => this.toAdminItem(row)), waiting: rows.length };
  }

  async adminItem(id: string): Promise<AdminDepositItem> {
    const row = await this.prisma.client.deposit.findUnique({ where: { id } });
    if (!row) throw AppError.notFound("There is no such deposit.");
    return this.toAdminItem(row);
  }

  private toView(row: Deposit): DepositView {
    return {
      id: row.id,
      network: row.network,
      txHash: row.txHash,
      amount: row.amount.toString(),
      status: row.status,
      confirmations: row.confirmations,
      confirmationsRequired: this.chain.finality.confirmations,
      detectedAt: row.detectedAt.toISOString(),
      creditedAt: row.creditedAt?.toISOString() ?? null,
    };
  }

  private toAdminItem(row: Deposit): AdminDepositItem {
    return {
      ...this.toView(row),
      logIndex: row.logIndex,
      blockNumber: row.blockNumber.toString(),
      fromAddress: row.fromAddress,
      toAddress: row.toAddress,
      tokenContract: row.tokenContract,
      rawAmount: row.rawAmount,
      userId: row.userId,
      detectedVia: row.detectedVia,
      reviewReason: row.reviewReason,
      ledgerTransactionId: row.ledgerTransactionId,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionReason: row.decisionReason,
      correlationId: row.correlationId,
    };
  }
}
