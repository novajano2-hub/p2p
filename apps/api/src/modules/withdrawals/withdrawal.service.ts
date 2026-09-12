import {
  KYC_TIERS,
  type AdminWithdrawalItem,
  type AdminWithdrawalQueueResponse,
  type CreateWithdrawalRequest,
  type WithdrawalLimitsResponse,
  type WithdrawalView,
} from "@abay/contracts";
import {
  type Prisma,
  type Withdrawal,
  type WithdrawalApproval,
  type WithdrawalStatus,
} from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { v7 as uuidv7 } from "uuid";

import { AppError } from "@/common/errors/app-error";
import { IdempotencyService, requestHash } from "@/common/idempotency/idempotency.service";
import { formatUsdt, toChainUnits } from "@/common/money/units";
import { IllegalTransitionError } from "@/common/state-machine/transition";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { type AdminSessionContext } from "@/modules/admin/admin-session.service";
import { AuditService } from "@/modules/audit/audit.service";
import { verifyPassword } from "@/modules/auth/tokens";
import { normalizeAddress } from "@/modules/blockchain/address";
import {
  BLOCKCHAIN_GATEWAY,
  type BlockchainGateway,
} from "@/modules/blockchain/blockchain.gateway";
import { chainConfig, type ChainConfig } from "@/modules/blockchain/chain-config";
import { CUSTODY_PROVIDER, type CustodyProvider } from "@/modules/custody/custody.provider";
import { confirmationsOf } from "@/modules/deposits/deposit.machine";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import { EMAIL_EVENT } from "@/modules/outbox/handlers/email.handler";
import { OutboxService } from "@/modules/outbox/outbox.service";
import {
  RISK_ENGINE,
  type RiskEngine,
  type WithdrawalRiskVerdict,
} from "@/modules/risk/risk.engine";
import { withdrawalMail } from "@/modules/withdrawals/withdrawal-mail";
import {
  assertWithdrawalTransition,
  CANCELLABLE,
  messageFor,
  stageOf,
} from "@/modules/withdrawals/withdrawal.machine";

/*
  Money going out: the withdrawal state machine (state-machines.md 2) under
  the separation ADR-0010 demands.

  The four separations are four different callers here, and no one of them
  can do the next one's job:

    request       an HTTP handler. Moves the customer's funds from available
                  to pending-withdrawal (JE-7) and can cause no signature.
    authorize     the risk engine, then a person above the thresholds. Its
                  own transition, its own audit event, its own role.
    sign          the worker, through the custody provider, which enforces
                  its own policy that this code cannot alter.
    settle        confirmation from the chain, with the ambiguous case
                  handled by refusing to guess.

  The rule that governs all of it: a hold is released only from a state
  where non-broadcast is certain. BUILD_FAILED and SIGN_REFUSED are certain.
  BROADCAST_UNKNOWN is not, and so it never retries and never refunds - it
  waits for a person who has looked at the chain (AT-9).
*/

const SUBJECT = "withdrawal";
const HOUR_MS = 60 * 60 * 1000;

/** How long after a password change a withdrawal is refused (state-machines.md: "security-change cooldown"). */
const SECURITY_COOLDOWN_HOURS = 24;

/*
  A withdrawal left in SIGNING for this long is one whose worker died mid-call.
  Asking the provider again is safe - it is idempotent on the client reference
  - and it is the only way the money ever gets unstuck.
*/
const SIGNING_GRACE_MS = 60_000;

/*
  How long a broadcast transaction may be missing from the chain before it
  becomes a question for a person. Long, deliberately: "not indexed yet" and
  "never sent" look identical, and only one of them is safe to act on.
*/
const DROPPED_AFTER_MS = 30 * 60_000;

/** Declaring that nothing was ever sent takes two administrators (ADR-0010). */
const FAILURE_APPROVALS_REQUIRED = 2;

interface Context {
  correlationId: string;
  ip?: string | undefined;
}

type WithdrawalRow = Withdrawal & { approvals?: WithdrawalApproval[] };

/** A Prisma transaction, as every private step here takes one. */
type Tx = Prisma.TransactionClient;

@Injectable()
export class WithdrawalService {
  private readonly chain: ChainConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
    @Inject(BLOCKCHAIN_GATEWAY) private readonly gateway: BlockchainGateway,
    @Inject(CUSTODY_PROVIDER) private readonly custody: CustodyProvider,
    @Inject(RISK_ENGINE) private readonly risk: RiskEngine,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.chain = chainConfig(env);
    this.logger.setContext(WithdrawalService.name);
  }

  /* -------------------------------------------------------------- limits */

  /** What this customer may send right now, and what they have already used today. */
  async limits(userId: string): Promise<WithdrawalLimitsResponse> {
    const [user, available, usedToday] = await Promise.all([
      this.prisma.client.user.findUniqueOrThrow({
        where: { id: userId },
        select: { kycStatus: true },
      }),
      this.ledger.balance(accounts.userAvailable(userId)),
      this.dailyTotal(userId),
    ]);
    const dailyMaximum = this.dailyCeiling(user.kycStatus);
    const remaining = dailyMaximum > usedToday ? dailyMaximum - usedToday : 0n;
    return {
      network: this.chain.network,
      asset: this.chain.token.symbol,
      minimum: this.chain.withdrawal.min.toString(),
      maximum: this.chain.withdrawal.max.toString(),
      dailyMaximum: dailyMaximum.toString(),
      dailyRemaining: remaining.toString(),
      available: available.toString(),
      fee: "0",
    };
  }

  /*
    The tier's daily ceiling, in millionths, and the configured maximum,
    whichever is lower. KYC_TIERS carries placeholder figures in whole USD
    (see the note beside it in @abay/contracts); one USDT is treated as one
    USD for the ceiling, which is what a customer would expect it to mean.
  */
  private dailyCeiling(kycStatus: "NOT_STARTED" | "PENDING" | "APPROVED" | "REJECTED"): bigint {
    const tier = kycStatus === "APPROVED" ? KYC_TIERS.verified : KYC_TIERS.unverified;
    const fromTier = BigInt(tier.dailyWithdrawalUsd) * 1_000_000n;
    const configured = this.chain.withdrawal.dailyMax;
    return fromTier < configured ? fromTier : configured;
  }

  /** Millionths requested in the last 24 hours that were not returned to the customer. */
  private async dailyTotal(userId: string): Promise<bigint> {
    const rows = await this.prisma.client.withdrawal.findMany({
      where: {
        userId,
        requestedAt: { gte: new Date(Date.now() - 24 * HOUR_MS) },
        status: {
          notIn: ["CANCELLED", "REJECTED", "BUILD_FAILED", "SIGN_REFUSED", "FAILED_CONFIRMED"],
        },
      },
      select: { amount: true },
    });
    return rows.reduce((sum, row) => sum + row.amount, 0n);
  }

  /* ------------------------------------------------------------- request */

  /*
    The customer asks. Everything that could refuse the request is checked
    before anything is written, the password among them; then one
    transaction moves their funds from available to pending-withdrawal
    (JE-7) and records the request. The idempotency key the client sent is
    claimed in that same transaction, so the same tap twice - or a retry
    after a dropped reply - is one withdrawal (ADR-0007).

    What this method cannot do, by construction, is cause a signature.
  */
  async request(
    userId: string,
    input: CreateWithdrawalRequest,
    clientKey: string,
    context: Context,
  ): Promise<WithdrawalView> {
    const amount = BigInt(input.amount);
    const destination = normalizeAddress(input.destination);
    await this.assertMayWithdraw(userId, input.password);

    if (input.network !== this.chain.network) {
      throw AppError.validation([{ path: "network", message: "That network is not supported." }]);
    }
    if (amount < this.chain.withdrawal.min || amount > this.chain.withdrawal.max) {
      throw AppError.validation([
        {
          path: "amount",
          message: `Enter between ${formatUsdt(this.chain.withdrawal.min)} and ${formatUsdt(this.chain.withdrawal.max)} USDT.`,
        },
      ]);
    }
    // Sending to an address we issued would credit it straight back as a
    // deposit, having paid gas to do nothing. It is always a mistake.
    const ours = await this.prisma.client.attributionAddress.findUnique({
      where: { network_address: { network: this.chain.network, address: destination } },
      select: { id: true },
    });
    if (ours) {
      throw AppError.validation([
        {
          path: "destination",
          message: "That is a BIRQ deposit address. Enter an address outside BIRQ.",
        },
      ]);
    }

    const limits = await this.limits(userId);
    if (amount > BigInt(limits.dailyRemaining)) {
      throw AppError.validation([
        {
          path: "amount",
          message: `That is over your daily limit. You have ${formatUsdt(BigInt(limits.dailyRemaining))} USDT left today.`,
        },
      ]);
    }
    if (amount > BigInt(limits.available)) {
      throw AppError.insufficientFunds("You do not have that much available.");
    }
    return this.create(userId, { amount, destination, clientKey }, context);
  }

  /** The write half of a request: JE-7, the row, the audit event, under the client's key. */
  private async create(
    userId: string,
    input: { amount: bigint; destination: string; clientKey: string },
    context: Context,
  ): Promise<WithdrawalView> {
    const id = uuidv7();
    const { amount, destination, clientKey } = input;
    const result = await this.idempotency.execute(
      {
        userId,
        endpoint: "withdrawals.create",
        key: clientKey,
        requestHash: requestHash({ amount: amount.toString(), destination }),
      },
      async (tx) => {
        // JE-7. The ledger locks the balance row and refuses an overdraw
        // while it holds it, so this is where the real check happens.
        const posted = await this.ledger.postIn(tx, {
          reason: "WITHDRAWAL_HELD",
          asset: "USDT",
          reference: { type: SUBJECT, id },
          actor: { type: "USER", id: userId },
          correlationId: context.correlationId,
          idempotencyKey: `withdrawal:${id}:hold`,
          lines: [
            { account: accounts.userAvailable(userId), direction: "DEBIT", amount },
            { account: accounts.userPendingWithdrawal(userId), direction: "CREDIT", amount },
            { account: accounts.platform("WITHDRAWAL_FEES"), direction: "CREDIT", amount: 0n },
          ],
        });
        await tx.withdrawal.create({
          data: {
            id,
            userId,
            network: this.chain.network,
            asset: this.chain.token.symbol,
            amount,
            fee: 0n,
            destination,
            status: "REQUESTED",
            holdTransactionId: posted.id,
            clientKey,
            correlationId: context.correlationId,
          },
        });
        await this.audit.record(
          {
            action: "withdrawal.requested",
            actor: null,
            subject: { type: SUBJECT, id },
            after: { userId, amount: amount.toString(), destination, holdTransactionId: posted.id },
            correlationId: context.correlationId,
            ip: context.ip ?? null,
          },
          tx,
        );
        return { status: 201, body: { withdrawalId: id } };
      },
    );

    const withdrawalId = result.body.withdrawalId;
    // Authorization is its own transition, and the risk engine is an adapter,
    // so it is consulted out here rather than inside the transaction (AT-19).
    if (!result.replayed) await this.evaluate(withdrawalId, context);
    return this.getForUser(userId, withdrawalId);
  }

  /*
    Step-up (state-machines.md: "step-up auth passed") and the security
    cooldown. The password is checked against the account's own hash, here
    and nowhere else in this module; a session cookie alone is deliberately
    not enough to move money off the platform. The cooldown is the other
    half of the same defence: somebody who has just changed the password is
    exactly who should not be able to empty the account this minute.
  */
  private async assertMayWithdraw(userId: string, password: string): Promise<void> {
    const identity = await this.prisma.client.authIdentity.findUnique({
      where: { userId_provider: { userId, provider: "PASSWORD" } },
      select: { passwordHash: true, passwordChangedAt: true },
    });
    if (!identity?.passwordHash) {
      throw AppError.forbidden("Set a password on your account before withdrawing.");
    }
    if (!(await verifyPassword(identity.passwordHash, password))) {
      throw AppError.validation([{ path: "password", message: "That password is not right." }]);
    }
    const changedAt = identity.passwordChangedAt;
    if (changedAt && Date.now() - changedAt.getTime() < SECURITY_COOLDOWN_HOURS * HOUR_MS) {
      throw AppError.forbidden(
        `For your security, withdrawals are paused for ${SECURITY_COOLDOWN_HOURS} hours after a password change.`,
      );
    }
  }

  /* ----------------------------------------------------------- authorize */

  /**
   * REQUESTED to RISK_REVIEW, and on to APPROVED when the policy says so.
   * An engine that cannot answer holds the withdrawal for a person: an
   * unavailable risk check must never read as approval.
   */
  async evaluate(id: string, context: Context): Promise<void> {
    const withdrawal = await this.prisma.client.withdrawal.findUnique({ where: { id } });
    if (withdrawal?.status !== "REQUESTED") return;

    const [user, firstUsed, dailyTotal] = await Promise.all([
      this.prisma.client.user.findUniqueOrThrow({
        where: { id: withdrawal.userId },
        select: { kycStatus: true },
      }),
      this.destinationFirstUsedAt(withdrawal.userId, withdrawal.destination, id),
      this.dailyTotal(withdrawal.userId),
    ]);

    let verdict: WithdrawalRiskVerdict;
    try {
      verdict = await this.risk.evaluateWithdrawal({
        userId: withdrawal.userId,
        kycStatus: user.kycStatus,
        amount: withdrawal.amount,
        destination: withdrawal.destination,
        destinationFirstUsedAt: firstUsed,
        dailyTotal,
      });
    } catch (error) {
      this.logger.warn(
        { event: "withdrawal.risk_unavailable", err: error, withdrawalId: id },
        "risk engine failed; holding for review",
      );
      verdict = {
        decision: "REVIEW",
        score: 100,
        reasons: ["risk engine unavailable"],
        approvalsRequired: 1,
      };
    }

    await this.prisma.transaction("withdrawal:evaluate", async (tx) => {
      if ((await this.lock(tx, id)) !== "REQUESTED") return;
      assertWithdrawalTransition("REQUESTED", "RISK_REVIEW");
      await tx.withdrawal.update({
        where: { id },
        data: {
          status: "RISK_REVIEW",
          riskScore: verdict.score,
          riskReasons: verdict.reasons,
          approvalsRequired: verdict.approvalsRequired,
        },
      });
      await this.audit.record(
        {
          action: "withdrawal.risk_evaluated",
          actor: null,
          subject: { type: SUBJECT, id },
          after: {
            decision: verdict.decision,
            score: verdict.score,
            reasons: verdict.reasons,
            approvalsRequired: verdict.approvalsRequired,
          },
          correlationId: context.correlationId,
        },
        tx,
      );
      if (verdict.decision === "AUTO_APPROVE") {
        assertWithdrawalTransition("RISK_REVIEW", "APPROVED");
        await tx.withdrawal.update({ where: { id }, data: { status: "APPROVED" } });
        await this.audit.record(
          {
            action: "withdrawal.approved.auto",
            actor: null,
            subject: { type: SUBJECT, id },
            correlationId: context.correlationId,
          },
          tx,
        );
      }
    });
  }

  /** When this customer first sent to this address before. Null if never. */
  private async destinationFirstUsedAt(
    userId: string,
    destination: string,
    excludeId: string,
  ): Promise<Date | null> {
    const earlier = await this.prisma.client.withdrawal.findFirst({
      where: {
        userId,
        destination,
        id: { not: excludeId },
        status: { in: ["BROADCAST", "CONFIRMED", "MANUAL_INVESTIGATION", "BROADCAST_UNKNOWN"] },
      },
      orderBy: { requestedAt: "asc" },
      select: { requestedAt: true },
    });
    return earlier?.requestedAt ?? null;
  }

  /* -------------------------------------------------------- human review */

  /**
   * One administrator approves. Below the dual-approval threshold that is
   * the whole of it; above it, the second approval must come from someone
   * else, which the unique index on (withdrawal, admin) enforces rather
   * than trusting anyone to notice.
   */
  async approve(
    id: string,
    reason: string | null,
    session: AdminSessionContext,
    context: Context,
  ): Promise<AdminWithdrawalItem> {
    await this.prisma.transaction("withdrawal:approve", async (tx) => {
      const current = await this.lock(tx, id);
      if (current === null) throw AppError.notFound("There is no such withdrawal.");
      if (current !== "RISK_REVIEW") throw new IllegalTransitionError(SUBJECT, current, "APPROVED");

      const withdrawal = await tx.withdrawal.findUniqueOrThrow({
        where: { id },
        include: { approvals: true },
      });
      if (withdrawal.approvals.some((approval) => approval.adminId === session.admin.id)) {
        throw AppError.conflict("You have already approved this withdrawal.");
      }
      await tx.withdrawalApproval.create({
        data: {
          withdrawalId: id,
          adminId: session.admin.id,
          adminEmail: session.admin.email,
          reason,
        },
      });
      const approvals = withdrawal.approvals.length + 1;
      const required = Math.max(1, withdrawal.approvalsRequired);
      const enough = approvals >= required;
      if (enough) {
        assertWithdrawalTransition("RISK_REVIEW", "APPROVED");
        await tx.withdrawal.update({ where: { id }, data: { status: "APPROVED" } });
      }
      await this.audit.record(
        {
          action: enough ? "withdrawal.approved.manual" : "withdrawal.approval_recorded",
          actor: { id: session.admin.id, email: session.admin.email },
          subject: { type: SUBJECT, id },
          reason,
          before: { status: "RISK_REVIEW", approvals: withdrawal.approvals.length },
          after: { status: enough ? "APPROVED" : "RISK_REVIEW", approvals, required },
          correlationId: context.correlationId,
          ip: context.ip ?? null,
        },
        tx,
      );
    });
    return this.adminItem(id);
  }

  /** An administrator refuses. The hold goes back to the customer (JE-9). */
  async reject(
    id: string,
    reason: string,
    session: AdminSessionContext,
    context: Context,
  ): Promise<AdminWithdrawalItem> {
    await this.prisma.transaction("withdrawal:reject", async (tx) => {
      const current = await this.lock(tx, id);
      if (current === null) throw AppError.notFound("There is no such withdrawal.");
      if (current !== "RISK_REVIEW") throw new IllegalTransitionError(SUBJECT, current, "REJECTED");
      await this.release(tx, id, "REJECTED", reason, {
        actor: { id: session.admin.id, email: session.admin.email },
        action: "withdrawal.rejected",
        context,
      });
    });
    return this.adminItem(id);
  }

  /** The customer calls it off, while it is still theirs to call off (JE-9). */
  async cancel(userId: string, id: string, context: Context): Promise<WithdrawalView> {
    await this.prisma.transaction("withdrawal:cancel", async (tx) => {
      const mine = await tx.withdrawal.findFirst({ where: { id, userId }, select: { id: true } });
      if (!mine) throw AppError.notFound("There is no such withdrawal.");
      const current = await this.lock(tx, id);
      if (current === null) throw AppError.notFound("There is no such withdrawal.");
      if (!CANCELLABLE.includes(current)) {
        throw new IllegalTransitionError(SUBJECT, current, "CANCELLED");
      }
      await this.release(tx, id, "CANCELLED", null, {
        actor: null,
        action: "withdrawal.cancelled",
        context,
      });
    });
    return this.getForUser(userId, id);
  }

  /*
    JE-9, and the row with it. The one place a hold goes back, called only
    from states where nothing was broadcast: the ledger key is the
    withdrawal id, so even if two paths reached here the money could return
    only once.
  */
  private async release(
    tx: Tx,
    id: string,
    to: "REJECTED" | "CANCELLED" | "BUILD_FAILED" | "SIGN_REFUSED" | "FAILED_CONFIRMED",
    reason: string | null,
    meta: { actor: { id: string; email: string } | null; action: string; context: Context },
  ): Promise<void> {
    const withdrawal = await tx.withdrawal.findUniqueOrThrow({
      where: { id },
      include: { user: { select: { email: true } } },
    });
    assertWithdrawalTransition(withdrawal.status, to);

    const posted = await this.ledger.postIn(tx, {
      reason: "WITHDRAWAL_HOLD_RELEASED",
      asset: "USDT",
      reference: { type: SUBJECT, id },
      actor: meta.actor
        ? { type: "ADMIN", id: meta.actor.id }
        : { type: "USER", id: withdrawal.userId },
      correlationId: meta.context.correlationId,
      idempotencyKey: `withdrawal:${id}:release`,
      lines: [
        {
          account: accounts.userPendingWithdrawal(withdrawal.userId),
          direction: "DEBIT",
          amount: withdrawal.amount,
        },
        {
          account: accounts.userAvailable(withdrawal.userId),
          direction: "CREDIT",
          amount: withdrawal.amount,
        },
      ],
    });
    await tx.withdrawal.update({
      where: { id },
      data: {
        status: to,
        failureReason: reason,
        settledTransactionId: posted.id,
        settledAt: new Date(),
      },
    });
    await this.audit.record(
      {
        action: meta.action,
        actor: meta.actor,
        subject: { type: SUBJECT, id },
        reason,
        before: { status: withdrawal.status },
        after: { status: to, settledTransactionId: posted.id },
        correlationId: meta.context.correlationId,
        ip: meta.context.ip ?? null,
      },
      tx,
    );
    await this.tell(tx, withdrawal, "WITHDRAWAL_RETURNED", meta.context.correlationId);
  }

  /** The customer is told, in the app and by email, through the outbox. */
  private async tell(
    tx: Tx,
    withdrawal: Withdrawal & { user: { email: string } },
    type: "WITHDRAWAL_SENT" | "WITHDRAWAL_RETURNED",
    correlationId: string,
  ): Promise<void> {
    const sent = type === "WITHDRAWAL_SENT";
    await this.notifications.notify(
      {
        userId: withdrawal.userId,
        type,
        title: sent ? "Withdrawal sent" : "Withdrawal returned",
        body: sent
          ? `${formatUsdt(withdrawal.amount)} USDT was sent to ${withdrawal.destination}.`
          : `${formatUsdt(withdrawal.amount)} USDT is back in your available balance.`,
        link: "/wallet",
      },
      tx,
    );
    await this.outbox.enqueue(tx, {
      type: EMAIL_EVENT,
      payload: {
        ...withdrawalMail({
          to: withdrawal.user.email,
          appName: this.env.APP_NAME,
          amount: withdrawal.amount,
          destination: withdrawal.destination,
          sent,
        }),
      },
      correlationId,
    });
  }

  /* --------------------------------------------------- build, sign, send */

  /**
   * One pass of the broadcaster: every approved withdrawal built, signed and
   * sent, plus any left in SIGNING by a worker that died mid-call. Re-asking
   * the provider for one of those is safe and is the whole reason the client
   * reference exists (ADR-0010): the same reference is the same transfer, so
   * a second ask returns the first answer rather than sending again.
   */
  async processApproved(
    limit = 25,
  ): Promise<{ broadcast: number; failed: number; unknown: number }> {
    const stale = new Date(Date.now() - SIGNING_GRACE_MS);
    const due = await this.prisma.client.withdrawal.findMany({
      where: {
        OR: [{ status: "APPROVED" }, { status: "SIGNING", updatedAt: { lt: stale } }],
      },
      orderBy: { requestedAt: "asc" },
      take: limit,
      select: { id: true, status: true },
    });

    const tally = { broadcast: 0, failed: 0, unknown: 0 };
    for (const row of due) {
      const outcome = await this.sendOne(row.id, row.status === "SIGNING");
      if (outcome === "broadcast") tally.broadcast += 1;
      else if (outcome === "unknown") tally.unknown += 1;
      else if (outcome === "failed") tally.failed += 1;
    }
    return tally;
  }

  private async sendOne(
    id: string,
    resuming: boolean,
  ): Promise<"broadcast" | "failed" | "unknown" | "skipped"> {
    const withdrawal = await this.prisma.client.withdrawal.findUnique({ where: { id } });
    if (!withdrawal) return "skipped";

    if (!resuming) {
      const prepared = await this.prepare(id);
      if (prepared !== "ready") return prepared === "failed" ? "failed" : "skipped";
    }

    /*
      The provider call, outside any transaction (AT-19): it is the slowest
      thing in this system and it must never be holding a customer's balance
      row while it waits. The client reference is the withdrawal's own id.
    */
    let outcome;
    try {
      outcome = await this.custody.transfer({
        clientRef: id,
        network: withdrawal.network,
        asset: withdrawal.asset,
        from: { treasury: "HOT" },
        to: withdrawal.destination,
        rawAmount: toChainUnits(withdrawal.amount, this.chain.token.decimals),
      });
    } catch (error) {
      /*
        The call itself failed - a timeout, a dropped connection. We do not
        know whether it reached the provider, so we do not know whether the
        coins left. This is the ambiguous case, and it is never retried and
        never refunded (AT-9).
      */
      this.logger.error(
        { event: "withdrawal.transfer_threw", err: error, withdrawalId: id },
        "the custody call failed with an unknown outcome",
      );
      outcome = { kind: "UNKNOWN" as const, providerRef: null };
    }

    return this.prisma.transaction("withdrawal:sent", async (tx) => {
      if ((await this.lock(tx, id)) !== "SIGNING") return "skipped";
      if (outcome.kind === "BROADCAST") {
        await this.recordBroadcast(tx, id, outcome.txHash, outcome.providerRef, {
          actor: null,
          action: "withdrawal.broadcast",
          context: { correlationId: withdrawal.correlationId },
        });
        return "broadcast";
      }
      if (outcome.kind === "REFUSED") {
        // An explicit, pre-broadcast refusal: nothing was sent, so the hold
        // may go back. This is the only certainty the provider gives us here.
        await this.release(tx, id, "SIGN_REFUSED", outcome.reason, {
          actor: null,
          action: "withdrawal.sign_refused",
          context: { correlationId: withdrawal.correlationId },
        });
        return "failed";
      }

      assertWithdrawalTransition("SIGNING", "BROADCAST_UNKNOWN");
      await tx.withdrawal.update({
        where: { id },
        data: {
          status: "BROADCAST_UNKNOWN",
          providerRef: outcome.providerRef,
          failureReason: "the provider could not confirm whether the transfer was sent",
        },
      });
      await this.audit.record(
        {
          action: "withdrawal.broadcast_unknown",
          actor: null,
          subject: { type: SUBJECT, id },
          before: { status: "SIGNING" },
          after: { status: "BROADCAST_UNKNOWN", providerRef: outcome.providerRef },
          correlationId: withdrawal.correlationId,
        },
        tx,
      );
      // Straight on to a person. No ledger entry: we do not know what happened.
      assertWithdrawalTransition("BROADCAST_UNKNOWN", "MANUAL_INVESTIGATION");
      await tx.withdrawal.update({ where: { id }, data: { status: "MANUAL_INVESTIGATION" } });
      await this.audit.record(
        {
          action: "withdrawal.investigation_opened",
          actor: null,
          subject: { type: SUBJECT, id },
          after: { status: "MANUAL_INVESTIGATION" },
          correlationId: withdrawal.correlationId,
        },
        tx,
      );
      this.logger.error(
        {
          event: "withdrawal.needs_investigation",
          withdrawalId: id,
          providerRef: outcome.providerRef,
        },
        "a withdrawal needs a person: the broadcast outcome is unknown",
      );
      return "unknown";
    });
  }

  /*
    APPROVED to SIGNING: our own preparation, before anything leaves. The
    treasury check is the precondition state-machines.md names, and failing
    it is a build failure - nothing was sent, so the hold goes back.
  */
  private async prepare(id: string): Promise<"ready" | "failed" | "skipped"> {
    const hot = await this.ledger.balance(accounts.platform("TREASURY_HOT"));
    return this.prisma.transaction("withdrawal:build", async (tx) => {
      if ((await this.lock(tx, id)) !== "APPROVED") return "skipped";
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id } });

      assertWithdrawalTransition("APPROVED", "BUILDING");
      await tx.withdrawal.update({
        where: { id },
        data: { status: "BUILDING", buildAttempts: { increment: 1 } },
      });

      if (hot < withdrawal.amount) {
        const reason = "the hot treasury does not hold enough to send this";
        this.logger.error(
          {
            event: "withdrawal.treasury_short",
            withdrawalId: id,
            need: withdrawal.amount.toString(),
          },
          reason,
        );
        await this.release(tx, id, "BUILD_FAILED", reason, {
          actor: null,
          action: "withdrawal.build_failed",
          context: { correlationId: withdrawal.correlationId },
        });
        return "failed";
      }

      assertWithdrawalTransition("BUILDING", "SIGNING");
      await tx.withdrawal.update({ where: { id }, data: { status: "SIGNING" } });
      await this.audit.record(
        {
          action: "withdrawal.built",
          actor: null,
          subject: { type: SUBJECT, id },
          after: { status: "SIGNING" },
          correlationId: withdrawal.correlationId,
        },
        tx,
      );
      return "ready";
    });
  }

  /*
    JE-8a: the coins have left the hot treasury and are in transit. Posted
    when - and only when - we know a transaction is on its way, either
    because the provider said so or because a person found it on the chain.
    The customer's liability is untouched: we still owe them until it
    confirms.
  */
  private async recordBroadcast(
    tx: Tx,
    id: string,
    txHash: string,
    providerRef: string | null,
    meta: { actor: { id: string; email: string } | null; action: string; context: Context },
  ): Promise<void> {
    const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id } });
    assertWithdrawalTransition(withdrawal.status, "BROADCAST");
    const posted = await this.ledger.postIn(tx, {
      reason: "WITHDRAWAL_BROADCAST",
      asset: "USDT",
      reference: { type: SUBJECT, id },
      actor: meta.actor ? { type: "ADMIN", id: meta.actor.id } : { type: "SYSTEM" },
      correlationId: meta.context.correlationId,
      idempotencyKey: `withdrawal:${id}:broadcast`,
      lines: [
        { account: accounts.platform("IN_TRANSIT"), direction: "DEBIT", amount: withdrawal.amount },
        {
          account: accounts.platform("TREASURY_HOT"),
          direction: "CREDIT",
          amount: withdrawal.amount,
        },
      ],
    });
    await tx.withdrawal.update({
      where: { id },
      data: {
        status: "BROADCAST",
        txHash: txHash.toLowerCase(),
        providerRef,
        broadcastAt: new Date(),
        broadcastTransactionId: posted.id,
        failureReason: null,
      },
    });
    await this.audit.record(
      {
        action: meta.action,
        actor: meta.actor,
        subject: { type: SUBJECT, id },
        before: { status: withdrawal.status },
        after: { status: "BROADCAST", txHash, broadcastTransactionId: posted.id },
        correlationId: meta.context.correlationId,
        ip: meta.context.ip ?? null,
      },
      tx,
    );
  }

  /* ------------------------------------------------------------- confirm */

  /** One pass of the confirmer: every broadcast withdrawal against the chain. */
  async confirmBroadcast(limit = 50): Promise<{ confirmed: number; investigating: number }> {
    const head = await this.gateway.headBlock(this.chain.network);
    const due = await this.prisma.client.withdrawal.findMany({
      where: { status: "BROADCAST", network: this.chain.network },
      orderBy: { broadcastAt: "asc" },
      take: limit,
      select: { id: true },
    });
    const tally = { confirmed: 0, investigating: 0 };
    for (const { id } of due) {
      const outcome = await this.confirmOne(id, head);
      if (outcome === "confirmed") tally.confirmed += 1;
      else if (outcome === "investigating") tally.investigating += 1;
    }
    return tally;
  }

  private async confirmOne(
    id: string,
    head: bigint,
  ): Promise<"waiting" | "confirmed" | "investigating" | "skipped"> {
    const withdrawal = await this.prisma.client.withdrawal.findUnique({
      where: { id },
      include: { user: { select: { email: true } } },
    });
    if (withdrawal?.status !== "BROADCAST" || !withdrawal.txHash) return "skipped";

    const transfer = await this.gateway.findTransfer(withdrawal.network, withdrawal.txHash, 0);
    if (!transfer) {
      /*
        The transaction we were told about is not on the chain. It may simply
        not be indexed yet; only once the chain has moved well past where it
        should have been is it treated as dropped - and even then this is a
        question for a person, never an automatic refund, because "not found"
        and "never sent" are not the same statement (AT-9).
      */
      const since = withdrawal.broadcastAt ?? withdrawal.requestedAt;
      if (Date.now() - since.getTime() < DROPPED_AFTER_MS) return "waiting";
      return this.prisma.transaction("withdrawal:dropped", async (tx) => {
        if ((await this.lock(tx, id)) !== "BROADCAST") return "skipped";
        assertWithdrawalTransition("BROADCAST", "MANUAL_INVESTIGATION");
        await tx.withdrawal.update({
          where: { id },
          data: {
            status: "MANUAL_INVESTIGATION",
            failureReason: "the transaction is no longer on the chain",
          },
        });
        await this.audit.record(
          {
            action: "withdrawal.dropped",
            actor: null,
            subject: { type: SUBJECT, id },
            before: { status: "BROADCAST" },
            after: { status: "MANUAL_INVESTIGATION", txHash: withdrawal.txHash },
            correlationId: withdrawal.correlationId,
          },
          tx,
        );
        return "investigating";
      });
    }

    const confirmations = confirmationsOf(head, transfer.blockNumber);
    if (confirmations < this.chain.finality.confirmations) {
      await this.prisma.client.withdrawal.updateMany({
        where: { id, status: "BROADCAST" },
        data: { confirmations, blockNumber: transfer.blockNumber },
      });
      return "waiting";
    }

    return this.prisma.transaction("withdrawal:confirm", async (tx) => {
      if ((await this.lock(tx, id)) !== "BROADCAST") return "skipped";
      assertWithdrawalTransition("BROADCAST", "CONFIRMED");
      /*
        JE-8b: the debt is extinguished. We owe the customer less and we
        control fewer coins; the platform's balance sheet shrinks on both
        sides, which is exactly what a withdrawal is.
      */
      const posted = await this.ledger.postIn(tx, {
        reason: "WITHDRAWAL_CONFIRMED",
        asset: "USDT",
        reference: { type: SUBJECT, id },
        actor: { type: "SYSTEM" },
        correlationId: withdrawal.correlationId,
        idempotencyKey: `withdrawal:${id}:confirm`,
        lines: [
          {
            account: accounts.userPendingWithdrawal(withdrawal.userId),
            direction: "DEBIT",
            amount: withdrawal.amount,
          },
          {
            account: accounts.platform("IN_TRANSIT"),
            direction: "CREDIT",
            amount: withdrawal.amount,
          },
        ],
      });
      await tx.withdrawal.update({
        where: { id },
        data: {
          status: "CONFIRMED",
          confirmations,
          blockNumber: transfer.blockNumber,
          settledTransactionId: posted.id,
          settledAt: new Date(),
        },
      });
      await this.audit.record(
        {
          action: "withdrawal.confirmed",
          actor: null,
          subject: { type: SUBJECT, id },
          before: { status: "BROADCAST" },
          after: { status: "CONFIRMED", settledTransactionId: posted.id },
          correlationId: withdrawal.correlationId,
        },
        tx,
      );
      await this.tell(tx, withdrawal, "WITHDRAWAL_SENT", withdrawal.correlationId);
      return "confirmed";
    });
  }

  /* ------------------------------------------------------- investigation */

  /**
   * A person resolves an ambiguous broadcast, against chain state and never
   * against the provider's word (ADR-0010, AT-9).
   *
   * Finding the transaction takes one administrator: it is a fact, and it
   * moves the withdrawal forward to where it would have been. Declaring that
   * nothing was ever sent takes two, because it is the one action here that
   * gives money back, and being wrong about it means giving away coins that
   * are already gone.
   */
  async resolveInvestigation(
    id: string,
    outcome: "BROADCAST" | "FAILED",
    txHash: string | undefined,
    reason: string,
    session: AdminSessionContext,
    context: Context,
  ): Promise<AdminWithdrawalItem> {
    const withdrawal = await this.prisma.client.withdrawal.findUnique({ where: { id } });
    if (!withdrawal) throw AppError.notFound("There is no such withdrawal.");
    if (withdrawal.status !== "MANUAL_INVESTIGATION") {
      throw new IllegalTransitionError(
        SUBJECT,
        withdrawal.status,
        outcome === "BROADCAST" ? "BROADCAST" : "FAILED_CONFIRMED",
      );
    }

    if (outcome === "BROADCAST") {
      if (!txHash) {
        throw AppError.validation([
          { path: "txHash", message: "Name the transaction you found on the chain." },
        ]);
      }
      // Checked against the chain itself, here, before it is believed.
      const transfer = await this.gateway.findTransfer(withdrawal.network, txHash, 0);
      if (!transfer) {
        throw AppError.conflict("That transaction is not on the chain. Check the hash.");
      }
      await this.prisma.transaction("withdrawal:investigation_broadcast", async (tx) => {
        if ((await this.lock(tx, id)) !== "MANUAL_INVESTIGATION") {
          throw AppError.conflict("This withdrawal was resolved by someone else a moment ago.");
        }
        await this.recordBroadcast(tx, id, txHash, withdrawal.providerRef, {
          actor: { id: session.admin.id, email: session.admin.email },
          action: "withdrawal.investigation_resolved_broadcast",
          context,
        });
      });
      return this.adminItem(id);
    }

    await this.prisma.transaction("withdrawal:investigation_failed", async (tx) => {
      if ((await this.lock(tx, id)) !== "MANUAL_INVESTIGATION") {
        throw AppError.conflict("This withdrawal was resolved by someone else a moment ago.");
      }
      const existing = await tx.withdrawalApproval.findMany({
        where: { withdrawalId: id, decision: "FAILED_CONFIRMED" },
      });
      if (existing.some((approval) => approval.adminId === session.admin.id)) {
        throw AppError.conflict("You have already confirmed this one as never sent.");
      }
      await tx.withdrawalApproval.create({
        data: {
          withdrawalId: id,
          adminId: session.admin.id,
          adminEmail: session.admin.email,
          decision: "FAILED_CONFIRMED",
          reason,
        },
      });
      const confirmations = existing.length + 1;
      if (confirmations < FAILURE_APPROVALS_REQUIRED) {
        await this.audit.record(
          {
            action: "withdrawal.investigation_failure_seconded",
            actor: { id: session.admin.id, email: session.admin.email },
            subject: { type: SUBJECT, id },
            reason,
            after: { confirmations, required: FAILURE_APPROVALS_REQUIRED },
            correlationId: context.correlationId,
            ip: context.ip ?? null,
          },
          tx,
        );
        return;
      }
      await this.release(tx, id, "FAILED_CONFIRMED", reason, {
        actor: { id: session.admin.id, email: session.admin.email },
        action: "withdrawal.investigation_resolved_failed",
        context,
      });
    });
    return this.adminItem(id);
  }

  /* ---------------------------------------------------------------- read */

  async listForUser(userId: string): Promise<WithdrawalView[]> {
    const rows = await this.prisma.client.withdrawal.findMany({
      where: { userId },
      orderBy: { requestedAt: "desc" },
      take: 100,
    });
    return rows.map((row) => this.toView(row));
  }

  async getForUser(userId: string, id: string): Promise<WithdrawalView> {
    const row = await this.prisma.client.withdrawal.findFirst({ where: { id, userId } });
    if (!row) throw AppError.notFound("There is no such withdrawal.");
    return this.toView(row);
  }

  /** What an administrator has to decide, and what needs resolving against the chain. */
  async queue(): Promise<AdminWithdrawalQueueResponse> {
    const rows = await this.prisma.client.withdrawal.findMany({
      where: { status: { in: ["RISK_REVIEW", "MANUAL_INVESTIGATION"] } },
      orderBy: { requestedAt: "asc" },
      include: { approvals: { orderBy: { createdAt: "asc" } } },
      take: 200,
    });
    return {
      review: rows.filter((r) => r.status === "RISK_REVIEW").map((r) => this.toAdminItem(r)),
      investigation: rows
        .filter((r) => r.status === "MANUAL_INVESTIGATION")
        .map((r) => this.toAdminItem(r)),
    };
  }

  async adminItem(id: string): Promise<AdminWithdrawalItem> {
    const row = await this.prisma.client.withdrawal.findUnique({
      where: { id },
      include: { approvals: { orderBy: { createdAt: "asc" } } },
    });
    if (!row) throw AppError.notFound("There is no such withdrawal.");
    return this.toAdminItem(row);
  }

  /* ------------------------------------------------------------- plumbing */

  /** Locks the row for the rest of the transaction and returns its status as it is now. */
  private async lock(tx: Tx, id: string): Promise<WithdrawalStatus | null> {
    const rows = await tx.$queryRaw<{ status: WithdrawalStatus }[]>`
      SELECT status::text AS status FROM withdrawals WHERE id = ${id} FOR UPDATE`;
    return rows[0]?.status ?? null;
  }

  private toView(row: Withdrawal): WithdrawalView {
    return {
      id: row.id,
      network: row.network,
      asset: row.asset,
      amount: row.amount.toString(),
      fee: row.fee.toString(),
      destination: row.destination,
      stage: stageOf(row.status),
      status: row.status,
      txHash: row.txHash,
      confirmations: row.confirmations,
      confirmationsRequired: this.chain.finality.confirmations,
      message: messageFor(row.status, row.failureReason),
      requestedAt: row.requestedAt.toISOString(),
      settledAt: row.settledAt?.toISOString() ?? null,
    };
  }

  private toAdminItem(row: WithdrawalRow): AdminWithdrawalItem {
    return {
      ...this.toView(row),
      userId: row.userId,
      riskScore: row.riskScore,
      riskReasons: row.riskReasons,
      approvalsRequired: row.approvalsRequired,
      approvals: (row.approvals ?? []).map((approval) => ({
        adminId: approval.adminId,
        adminEmail: approval.adminEmail,
        reason: approval.reason,
        createdAt: approval.createdAt.toISOString(),
      })),
      providerRef: row.providerRef,
      buildAttempts: row.buildAttempts,
      failureReason: row.failureReason,
      holdTransactionId: row.holdTransactionId,
      broadcastTransactionId: row.broadcastTransactionId,
      settledTransactionId: row.settledTransactionId,
      correlationId: row.correlationId,
      broadcastAt: row.broadcastAt?.toISOString() ?? null,
    };
  }
}
