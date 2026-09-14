import {
  tierFor,
  type AdvertiserView,
  type CancelTradeRequest,
  type CreateTradeRequest,
  type MarkPaidRequest,
  type NotificationType,
  type PaymentMethodKind,
  type TradeEventsResponse,
  type TradeRole,
  type TradesQuery,
  type TradesResponse,
  type TradeView,
} from "@abay/contracts";
import {
  type LedgerActorType,
  type LedgerReason,
  type Prisma,
  type TradeStatus,
  type TraderStats,
} from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { v7 as uuidv7 } from "uuid";

import { AppError } from "@/common/errors/app-error";
import { IdempotencyService, requestHash } from "@/common/idempotency/idempotency.service";
import { afterCommit } from "@/common/io/transaction-scope";
import { amountForFiat, fiatForAmount, formatEtb } from "@/common/money/fiat";
import { formatUsdt } from "@/common/money/units";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { type Mail } from "@/infra/mail/mailer";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { AuditService } from "@/modules/audit/audit.service";
import { verifyPassword } from "@/modules/auth/tokens";
import { appendMessage } from "@/modules/chat/chat-append";
import { accounts } from "@/modules/ledger/account-code";
import { InsufficientFundsError } from "@/modules/ledger/ledger.errors";
import { LedgerService, type PostedTransaction } from "@/modules/ledger/ledger.service";
import { type PostingLine } from "@/modules/ledger/posting";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import { OfferService } from "@/modules/offers/offer.service";
import { EMAIL_EVENT } from "@/modules/outbox/handlers/email.handler";
import { OutboxService } from "@/modules/outbox/outbox.service";
import {
  PaymentDetailsCipher,
  TRADE_SNAPSHOT_PURPOSE,
} from "@/modules/payment-methods/payment-details.cipher";
import { PaymentMethodService } from "@/modules/payment-methods/payment-method.service";
import { RealtimeService } from "@/modules/realtime/realtime.service";
import { tradeMail, type TradeMailKind } from "@/modules/trades/trade-mail";
import {
  assertTradeTransition,
  isOpen,
  messageFor,
  OPEN,
  SETTLED,
} from "@/modules/trades/trade.machine";

/*
  The trade engine: the state machine in docs/architecture/state-machines.md
  3, with the escrow of ADR-0004 underneath it.

  Four things move money here, and each is one ledger transaction under the
  trade's own row lock:

    open      JE-3, the seller's available into the trade's escrow, in the
              same transaction as the row and the reservation on the offer.
              Two takers racing for one seller's last 100 USDT queue on the
              seller's balance row and the second finds it gone (AT-2, AT-3).
    release   JE-4, escrow to the buyer, less the fee. The seller's act
              alone, with their password again.
    refund    JE-5, escrow back to the seller: the buyer cancelling, or the
              expirer finding the deadline passed. Reverses JE-3 by id.
    decide    JE-6 or JE-5, an administrator's act, in the disputes module.

  Every settlement uses one idempotency key, trade:{id}:settle, so the escrow
  can empty exactly once whatever path reaches it (AT-5, AT-7, AT-14). And
  "I have paid" is deliberately not in the list: it changes a status and
  tells the seller, and moves nothing (AT-4).

  Locks are taken in one order everywhere - the trade row, then the offer,
  then the ledger balances, then the trader counters - so no two of these
  paths can wait on each other.
*/

const SUBJECT = "trade";
const HOUR_MS = 3_600_000;

interface Context {
  correlationId: string;
  ip?: string | undefined;
}

type Tx = Prisma.TransactionClient;

const WITH = {
  dispute: true,
  events: { where: { kind: "MARKED_PAID" as const }, take: 1 },
  reads: true,
} satisfies Prisma.TradeInclude;

type TradeRow = Prisma.TradeGetPayload<{ include: typeof WITH }>;

/** What one settlement posts and where the trade ends up. */
interface Settlement {
  to: TradeStatus;
  reason: LedgerReason;
  lines: readonly PostingLine[];
  actor: { type: LedgerActorType; id?: string | null };
  reversesTransactionId?: string | undefined;
  closeReason: string | null;
}

@Injectable()
export class TradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly offers: OfferService,
    private readonly paymentMethods: PaymentMethodService,
    private readonly cipher: PaymentDetailsCipher,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
    private readonly realtime: RealtimeService,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TradeService.name);
  }

  /* ---------------------------------------------------------------- open */

  /*
    Taking an offer. Everything that can refuse it is checked before any
    row is written; then one transaction, under the taker's Idempotency-Key,
    takes the amount off the offer, locks the escrow (JE-3), snapshots the
    payment instructions and writes the trade - together or not at all.
  */
  async create(
    takerId: string,
    input: CreateTradeRequest,
    clientKey: string,
    context: Context,
  ): Promise<TradeView> {
    const offer = await this.prisma.client.offer.findUnique({
      where: { id: input.offerId },
      include: {
        paymentMethods: { orderBy: { id: "asc" } },
        user: { select: { id: true, status: true, username: true } },
      },
    });
    if (offer?.status !== "ACTIVE" || offer.user.status !== "ACTIVE") {
      throw AppError.notFound("That offer is not available right now.");
    }
    if (offer.userId === takerId) throw AppError.conflict("You cannot take your own offer.");

    const taker = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: takerId },
      select: { status: true, kycStatus: true, username: true },
    });
    if (taker.status !== "ACTIVE") {
      throw AppError.forbidden("Your account cannot open trades right now.");
    }
    if (offer.requireVerified && taker.kycStatus !== "APPROVED") {
      throw AppError.forbidden("This advertiser trades with verified accounts only.");
    }
    if (offer.minCompletedTrades > 0) {
      const stats = await this.prisma.client.traderStats.findUnique({ where: { userId: takerId } });
      if ((stats?.tradesCompleted ?? 0) < offer.minCompletedTrades) {
        throw AppError.forbidden(
          `This advertiser trades with accounts that have completed at least ${offer.minCompletedTrades} trades.`,
        );
      }
    }

    // The amount, from whichever side the taker typed, and the birr it is worth.
    const price = offer.priceSantim;
    const amount =
      input.amount !== undefined
        ? BigInt(input.amount)
        : amountForFiat(BigInt(input.fiatSantim ?? "0"), price);
    const fiat = fiatForAmount(amount, price);
    if (amount < this.env.TRADE_MIN_AMOUNT_MICRO) {
      throw AppError.validation([
        {
          path: "amount",
          message: `Trade at least ${formatUsdt(this.env.TRADE_MIN_AMOUNT_MICRO)} USDT.`,
        },
      ]);
    }
    if (fiat < offer.minSantim || fiat > offer.maxSantim) {
      throw AppError.validation([
        {
          path: "amount",
          message: `This offer takes between ${formatEtb(offer.minSantim)} and ${formatEtb(offer.maxSantim)} birr a trade.`,
        },
      ]);
    }
    if (amount > offer.remainingAmount) {
      throw AppError.validation([
        {
          path: "amount",
          message: `Only ${formatUsdt(offer.remainingAmount)} USDT is left on this offer.`,
        },
      ]);
    }

    // Whoever gives up USDT is the seller and funds the escrow (ADR-0004).
    const buyerId = offer.side === "SELL" ? takerId : offer.userId;
    const sellerId = offer.side === "SELL" ? offer.userId : takerId;

    const rail = await this.chooseRail(takerId, offer.side, offer.paymentMethods, input);

    await this.assertWithinLimits(takerId, amount, true);
    await this.assertWithinLimits(offer.userId, amount, false);

    const fee = (amount * BigInt(this.env.TRADE_FEE_BPS)) / 10_000n;
    const id = uuidv7();

    const result = await this.idempotency.execute(
      {
        userId: takerId,
        endpoint: "trades.create",
        key: clientKey,
        requestHash: requestHash({
          offerId: offer.id,
          amount: amount.toString(),
          paymentMethodId: rail.paymentMethodId,
        }),
      },
      async (tx) => {
        const reserved = await this.offers.reserve(tx, offer.id, amount);
        if (!reserved) {
          throw AppError.conflict(
            "That offer no longer has enough available. Try a smaller amount or another offer.",
          );
        }
        // The price the taker was quoted is the price they get, or no trade:
        // an advertiser editing the ad at this very moment gets a taker who
        // looks again, not one who bought at a number they never saw.
        if (reserved.priceSantim !== price) {
          throw AppError.conflict(
            "The price of this offer just changed. Look at it again before you take it.",
          );
        }
        const snapshot = await this.paymentMethods.instructions(tx, rail.paymentMethodId);
        if (snapshot?.method.status !== "ACTIVE") {
          throw AppError.conflict("That payment method is no longer available.");
        }

        // JE-3. The ledger locks the seller's balance row and refuses an
        // overdraw while it holds it; that lock is what makes AT-2 hold.
        let posted: PostedTransaction;
        try {
          posted = await this.ledger.postIn(tx, {
            reason: "ESCROW_LOCKED",
            asset: "USDT",
            reference: { type: SUBJECT, id },
            actor: { type: "USER", id: takerId },
            correlationId: context.correlationId,
            idempotencyKey: `trade:${id}:lock`,
            lines: [
              { account: accounts.userAvailable(sellerId), direction: "DEBIT", amount },
              { account: accounts.tradeEscrow(id), direction: "CREDIT", amount },
            ],
          });
        } catch (error) {
          if (error instanceof InsufficientFundsError) {
            throw AppError.insufficientFunds(
              sellerId === takerId
                ? "You do not have that much available."
                : "The seller cannot fund this trade right now. Try another offer.",
            );
          }
          throw error;
        }

        // Database time, because the expirer compares against database time.
        const clock = await tx.$queryRaw<{ deadline: Date }[]>`
          SELECT now() + make_interval(mins => ${reserved.paymentWindowMinutes}::int) AS deadline`;
        const deadline =
          clock[0]?.deadline ?? new Date(Date.now() + reserved.paymentWindowMinutes * 60_000);

        await tx.trade.create({
          data: {
            id,
            offerId: offer.id,
            offerSide: offer.side,
            buyerId,
            sellerId,
            asset: "USDT",
            amount,
            fee,
            fiat: offer.fiat,
            priceSantim: price,
            fiatSantim: fiat,
            paymentMethodId: snapshot.method.id,
            paymentKind: snapshot.method.kind,
            paymentLabel: snapshot.method.label,
            paymentSnapshotEncrypted: this.cipher.encrypt(
              snapshot.instructions,
              TRADE_SNAPSHOT_PURPOSE,
            ),
            paymentDeadline: deadline,
            escrowTransactionId: posted.id,
            clientKey,
            correlationId: context.correlationId,
          },
        });
        this.changed({ id, buyerId, sellerId }, "AWAITING_FIAT_PAYMENT");
        await tx.tradeEvent.create({
          data: {
            tradeId: id,
            kind: "CREATED",
            actorUserId: takerId,
            data: {
              amount: amount.toString(),
              fiatSantim: fiat.toString(),
              paymentKind: snapshot.method.kind,
            },
          },
        });
        await this.bumpStats(tx, [buyerId, sellerId], { tradesTotal: 1 });
        // The advertiser's standing first word, as the first line of the chat.
        if (offer.autoReply) {
          await appendMessage(tx, {
            tradeId: id,
            senderId: offer.userId,
            kind: "TEXT",
            body: offer.autoReply,
            clientMessageId: `auto-reply:${id}`,
          });
        }
        await this.audit.record(
          {
            action: "trade.created",
            actor: null,
            subject: { type: SUBJECT, id },
            after: {
              offerId: offer.id,
              buyerId,
              sellerId,
              amount: amount.toString(),
              fiatSantim: fiat.toString(),
              escrowTransactionId: posted.id,
            },
            correlationId: context.correlationId,
            ip: context.ip ?? null,
          },
          tx,
        );
        await this.tell(tx, {
          userId: offer.userId,
          type: "TRADE_OPENED",
          title: offer.side === "SELL" ? "Someone is buying from you" : "Someone is selling to you",
          body: `${taker.username} opened a trade for ${formatUsdt(amount)} USDT at ${formatEtb(fiat)} birr.`,
          tradeId: id,
          mail: {
            kind: "OPENED",
            role: offer.side === "SELL" ? "SELLER" : "BUYER",
            amount,
            fiatSantim: fiat,
            counterparty: taker.username,
          },
          correlationId: context.correlationId,
        });
        return { status: 201, body: { tradeId: id } };
      },
    );

    if (!result.replayed) {
      this.logger.info(
        {
          event: "trade.opened",
          tradeId: id,
          offerId: offer.id,
          correlationId: context.correlationId,
        },
        "trade opened",
      );
    }
    return this.getForUser(takerId, result.body.tradeId);
  }

  /* --------------------------------------------------------------- paid */

  /**
   * "I have paid". Changes the status, starts the seller's clock, and moves
   * no money whatsoever (AT-4). Allowed while the trade is still waiting -
   * the row lock decides a race with the expirer, and whichever commits
   * first is what happened.
   */
  async markPaid(
    userId: string,
    id: string,
    input: MarkPaidRequest,
    context: Context,
  ): Promise<TradeView> {
    await this.prisma.transaction("trade:mark-paid", async (tx) => {
      const trade = await this.lockParty(tx, userId, id);
      if (trade.buyerId !== userId) {
        throw AppError.forbidden("Only the buyer can mark a trade as paid.");
      }
      assertTradeTransition(trade.status, "BUYER_MARKED_PAID");
      const now = new Date();
      await tx.trade.update({
        where: { id },
        data: { status: "BUYER_MARKED_PAID", paidAt: now },
      });
      this.changed(trade, "BUYER_MARKED_PAID");
      await tx.tradeEvent.create({
        data: {
          tradeId: id,
          kind: "MARKED_PAID",
          actorUserId: userId,
          data: { reference: input.reference ?? null },
        },
      });
      await this.bumpStats(tx, [userId], {
        payMs: BigInt(now.getTime() - trade.createdAt.getTime()),
      });
      const buyer = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { username: true },
      });
      await this.tell(tx, {
        userId: trade.sellerId,
        type: "TRADE_PAID",
        title: "The buyer says they have paid",
        body: `${buyer.username} marked ${formatEtb(trade.fiatSantim)} birr as paid. Check your account before you release.`,
        tradeId: id,
        mail: {
          kind: "PAID",
          role: "SELLER",
          amount: trade.amount,
          fiatSantim: trade.fiatSantim,
          counterparty: buyer.username,
        },
        correlationId: context.correlationId,
      });
    });
    return this.getForUser(userId, id);
  }

  /* -------------------------------------------------------------- cancel */

  /**
   * The buyer calls it off before paying (JE-5). The buyer only: a seller
   * who could cancel after the birr was sent but before "I have paid" would
   * be keeping both.
   */
  async cancel(
    userId: string,
    id: string,
    input: CancelTradeRequest,
    context: Context,
  ): Promise<TradeView> {
    await this.prisma.transaction("trade:cancel", async (tx) => {
      const trade = await this.lockParty(tx, userId, id);
      if (trade.buyerId !== userId) {
        throw AppError.forbidden(
          "Only the buyer can cancel a trade. If they do not pay, it expires on its own.",
        );
      }
      await this.settle(tx, trade, {
        to: "CANCELLED",
        reason: "ESCROW_REFUNDED_CANCELLED",
        lines: [
          { account: accounts.tradeEscrow(id), direction: "DEBIT", amount: trade.amount },
          {
            account: accounts.userAvailable(trade.sellerId),
            direction: "CREDIT",
            amount: trade.amount,
          },
        ],
        actor: { type: "USER", id: userId },
        reversesTransactionId: trade.escrowTransactionId ?? undefined,
        closeReason: input.reason
          ? `Cancelled by the buyer: ${input.reason}`
          : "Cancelled by the buyer.",
      });
      await tx.tradeEvent.create({
        data: {
          tradeId: id,
          kind: "CANCELLED",
          actorUserId: userId,
          data: { reason: input.reason ?? null },
        },
      });
      await this.bumpStats(tx, [userId], { tradesFailed: 1 });
      await this.audit.record(
        {
          action: "trade.cancelled",
          actor: null,
          subject: { type: SUBJECT, id },
          reason: input.reason ?? null,
          before: { status: trade.status },
          after: { status: "CANCELLED" },
          correlationId: context.correlationId,
          ip: context.ip ?? null,
        },
        tx,
      );
      const buyer = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { username: true },
      });
      await this.tell(tx, {
        userId: trade.sellerId,
        type: "TRADE_CANCELLED",
        title: "Trade cancelled",
        body: `${buyer.username} cancelled the trade for ${formatUsdt(trade.amount)} USDT. It is back in your available balance.`,
        tradeId: id,
        mail: {
          kind: "CANCELLED",
          role: "SELLER",
          amount: trade.amount,
          fiatSantim: trade.fiatSantim,
          counterparty: buyer.username,
        },
        correlationId: context.correlationId,
      });
    });
    return this.getForUser(userId, id);
  }

  /* ------------------------------------------------------------- release */

  /**
   * The seller confirms the birr arrived and lets the USDT go (JE-4). The
   * seller only, with their password again; from BUYER_MARKED_PAID, or from
   * DISPUTED, since most appeals end with the seller seeing the money after
   * all. Exactly once: the row lock serialises repeats and the second one
   * finds a trade that is already COMPLETED (AT-5).
   */
  async release(
    userId: string,
    id: string,
    password: string,
    context: Context,
  ): Promise<TradeView> {
    await this.assertPassword(userId, password);
    await this.prisma.transaction("trade:release", async (tx) => {
      const trade = await this.lockParty(tx, userId, id);
      if (trade.sellerId !== userId)
        throw AppError.forbidden("Only the seller can release the USDT.");
      const receives = trade.amount - trade.fee;
      await this.settle(tx, trade, {
        to: "COMPLETED",
        reason: "ESCROW_RELEASED",
        lines: [
          { account: accounts.tradeEscrow(id), direction: "DEBIT", amount: trade.amount },
          { account: accounts.userAvailable(trade.buyerId), direction: "CREDIT", amount: receives },
          { account: accounts.platform("TRADE_FEES"), direction: "CREDIT", amount: trade.fee },
        ],
        actor: { type: "USER", id: userId },
        closeReason: null,
      });
      if (trade.status === "DISPUTED" && trade.dispute) {
        await tx.dispute.update({
          where: { id: trade.dispute.id },
          data: {
            status: "RESOLVED",
            outcome: "RELEASE_TO_BUYER",
            resolutionNote: "The seller released the USDT.",
            resolvedAt: new Date(),
          },
        });
      }
      await tx.tradeEvent.create({
        data: {
          tradeId: id,
          kind: "RELEASED",
          actorUserId: userId,
          data: { duringDispute: trade.status === "DISPUTED" },
        },
      });
      const now = Date.now();
      await this.bumpStats(tx, [trade.buyerId, trade.sellerId], { tradesCompleted: 1 });
      if (trade.paidAt) {
        await this.bumpStats(tx, [userId], { releaseMs: BigInt(now - trade.paidAt.getTime()) });
      }
      await this.audit.record(
        {
          action: "trade.released",
          actor: null,
          subject: { type: SUBJECT, id },
          before: { status: trade.status },
          after: {
            status: "COMPLETED",
            buyerReceives: receives.toString(),
            fee: trade.fee.toString(),
          },
          correlationId: context.correlationId,
          ip: context.ip ?? null,
        },
        tx,
      );
      const seller = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { username: true },
      });
      await this.tell(tx, {
        userId: trade.buyerId,
        type: "TRADE_RELEASED",
        title: "USDT received",
        body: `${seller.username} released ${formatUsdt(receives)} USDT to you. It is in your available balance.`,
        tradeId: id,
        mail: {
          kind: "RELEASED",
          role: "BUYER",
          amount: receives,
          fiatSantim: trade.fiatSantim,
          counterparty: seller.username,
        },
        correlationId: context.correlationId,
      });
    });
    return this.getForUser(userId, id);
  }

  /* -------------------------------------------------------------- expire */

  /**
   * One pass of the expirer: every trade still waiting to be paid whose
   * deadline the database says has passed. Each is its own transaction, and
   * a trade whose row is locked - a buyer pressing "I have paid" this very
   * second - is skipped rather than waited for; the next pass sees what
   * happened. Running this twice against the same trade is a no-op (AT-7).
   */
  async expireDue(limit = 50): Promise<number> {
    const due = await this.prisma.client.$queryRaw<{ id: string }[]>`
      SELECT id FROM trades
       WHERE status = 'AWAITING_FIAT_PAYMENT' AND payment_deadline <= now()
       ORDER BY payment_deadline
       LIMIT ${limit}`;
    let expired = 0;
    for (const { id } of due) {
      if (await this.expireOne(id)) expired += 1;
    }
    return expired;
  }

  private async expireOne(id: string): Promise<boolean> {
    return this.prisma.transaction("trade:expire", async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM trades
         WHERE id = ${id} AND status = 'AWAITING_FIAT_PAYMENT' AND payment_deadline <= now()
           FOR UPDATE SKIP LOCKED`;
      if (!locked[0]) return false;
      const trade = await tx.trade.findUniqueOrThrow({ where: { id }, include: WITH });

      await this.settle(tx, trade, {
        to: "EXPIRED",
        reason: "ESCROW_REFUNDED_EXPIRY",
        lines: [
          { account: accounts.tradeEscrow(id), direction: "DEBIT", amount: trade.amount },
          {
            account: accounts.userAvailable(trade.sellerId),
            direction: "CREDIT",
            amount: trade.amount,
          },
        ],
        actor: { type: "SYSTEM" },
        reversesTransactionId: trade.escrowTransactionId ?? undefined,
        closeReason: "The buyer did not pay in time.",
      });
      await tx.tradeEvent.create({ data: { tradeId: id, kind: "EXPIRED" } });
      await this.bumpStats(tx, [trade.buyerId], { tradesFailed: 1 });
      await this.audit.record(
        {
          action: "trade.expired",
          actor: null,
          subject: { type: SUBJECT, id },
          before: { status: trade.status },
          after: { status: "EXPIRED" },
          correlationId: trade.correlationId,
        },
        tx,
      );
      const names = await tx.user.findMany({
        where: { id: { in: [trade.buyerId, trade.sellerId] } },
        select: { id: true, username: true },
      });
      const nameOf = (userId: string) =>
        names.find((u) => u.id === userId)?.username ?? "the other party";
      for (const [userId, role, other] of [
        [trade.sellerId, "SELLER", trade.buyerId],
        [trade.buyerId, "BUYER", trade.sellerId],
      ] as const) {
        await this.tell(tx, {
          userId,
          type: "TRADE_EXPIRED",
          title: "Trade expired",
          body:
            role === "SELLER"
              ? `The trade for ${formatUsdt(trade.amount)} USDT expired unpaid. It is back in your available balance.`
              : `Your trade for ${formatUsdt(trade.amount)} USDT expired before you marked it paid.`,
          tradeId: id,
          mail: {
            kind: "EXPIRED",
            role,
            amount: trade.amount,
            fiatSantim: trade.fiatSantim,
            counterparty: nameOf(other),
          },
          correlationId: trade.correlationId,
        });
      }
      return true;
    });
  }

  /* ---------------------------------------------------------------- read */

  async listForUser(userId: string, query: TradesQuery): Promise<TradesResponse> {
    const rows = await this.prisma.client.trade.findMany({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
        status: { in: query.scope === "open" ? [...OPEN] : [...SETTLED] },
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: WITH,
      // uuidv7 ids sort by creation time, so this is newest first with a stable cursor.
      orderBy: { id: "desc" },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const trades = await this.toViews(page, userId);
    const last = page[page.length - 1];
    return { trades, nextCursor: rows.length > query.limit && last ? last.id : null };
  }

  async getForUser(userId: string, id: string): Promise<TradeView> {
    const row = await this.prisma.client.trade.findFirst({
      where: { id, OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: WITH,
    });
    if (!row) throw AppError.notFound("There is no such trade.");
    const [view] = await this.toViews([row], userId);
    if (!view) throw AppError.notFound("There is no such trade.");
    return view;
  }

  /** The timeline, from the viewer's side of the table. */
  async eventsForUser(userId: string, id: string): Promise<TradeEventsResponse> {
    const trade = await this.prisma.client.trade.findFirst({
      where: { id, OR: [{ buyerId: userId }, { sellerId: userId }] },
      select: { id: true },
    });
    if (!trade) throw AppError.notFound("There is no such trade.");
    const events = await this.prisma.client.tradeEvent.findMany({
      where: { tradeId: id },
      orderBy: { createdAt: "asc" },
    });
    return {
      events: events.map((event) => ({
        id: event.id,
        kind: event.kind,
        actor: event.actorAdminId
          ? "ADMIN"
          : event.actorUserId === userId
            ? "ME"
            : event.actorUserId
              ? "COUNTERPARTY"
              : "SYSTEM",
        data: (event.data as Record<string, unknown> | null) ?? null,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  /**
   * What this customer has locked in open trades as the seller: the sum of
   * those trades' escrow accounts, read from the ledger. The wallet's third
   * figure (ledger-taxonomy.md 3.1).
   */
  async escrowedFor(userId: string): Promise<bigint> {
    const rows = await this.prisma.client.$queryRaw<{ total: bigint | null }[]>`
      SELECT COALESCE(SUM(b.balance), 0)::bigint AS total
        FROM trades t
        JOIN ledger_accounts a ON a.code = 'LIAB:TRADE:' || t.id || ':USDT:ESCROW'
        JOIN ledger_account_balances b ON b.account_id = a.id
       WHERE t.seller_id = ${userId}
         AND t.status IN ('AWAITING_FIAT_PAYMENT', 'BUYER_MARKED_PAID', 'DISPUTED')`;
    return rows[0]?.total ?? 0n;
  }

  /** Whether this customer is a party to the trade. For the chat and the disputes. */
  async roleOf(userId: string, id: string): Promise<TradeRole | null> {
    const trade = await this.prisma.client.trade.findFirst({
      where: { id, OR: [{ buyerId: userId }, { sellerId: userId }] },
      select: { buyerId: true },
    });
    if (!trade) return null;
    return trade.buyerId === userId ? "BUYER" : "SELLER";
  }

  /* ------------------------------------------------------------- plumbing */

  /**
   * Both parties' open sockets learn the trade changed - once the change is
   * durable, never before, and never from inside the transaction (AT-19).
   * The frame carries the status and nothing else; a client refetches.
   */
  private changed(
    trade: { id: string; buyerId: string; sellerId: string },
    status: TradeStatus,
  ): void {
    void afterCommit(() =>
      this.realtime.tradeChanged({
        id: trade.id,
        buyerId: trade.buyerId,
        sellerId: trade.sellerId,
        status,
        updatedAt: new Date(),
      }),
    );
  }

  /**
   * Which rail the trade will use. On a SELL offer the buyer picks one of
   * the seller's kinds, defaulting to the first; on a BUY offer the taker
   * is the seller and names one of their own methods, which must be of a
   * kind the buyer said they can pay through.
   */
  private async chooseRail(
    takerId: string,
    side: "BUY" | "SELL",
    rails: { kind: PaymentMethodKind; paymentMethodId: string | null }[],
    input: CreateTradeRequest,
  ): Promise<{ paymentMethodId: string }> {
    if (side === "SELL") {
      const chosen = input.paymentKind
        ? rails.find((rail) => rail.kind === input.paymentKind)
        : rails[0];
      if (!chosen?.paymentMethodId) {
        throw AppError.validation([
          { path: "paymentKind", message: "Choose one of the ways this seller accepts payment." },
        ]);
      }
      return { paymentMethodId: chosen.paymentMethodId };
    }
    if (!input.paymentMethodId) {
      throw AppError.validation([
        {
          path: "paymentMethodId",
          message: "Choose which of your payment methods the buyer should pay to.",
        },
      ]);
    }
    const [method] = await this.paymentMethods.ownedActive(takerId, [input.paymentMethodId]);
    if (!method) {
      throw AppError.validation([
        {
          path: "paymentMethodId",
          message: "Choose a payment method of your own that is still active.",
        },
      ]);
    }
    if (!rails.some((rail) => rail.kind === method.kind)) {
      throw AppError.validation([
        {
          path: "paymentMethodId",
          message: "This buyer does not pay through that kind of account.",
        },
      ]);
    }
    return { paymentMethodId: method.id };
  }

  /*
    The daily ceiling from the KYC tier (KYC_TIERS.dailyTradeUsd, one USDT
    treated as one dollar) and the cap on trades open at once, for whichever
    party is being checked. The taker is told what to do about it; about the
    advertiser a taker only learns that this offer is not takeable now.
  */
  private async assertWithinLimits(userId: string, amount: bigint, taker: boolean): Promise<void> {
    const [user, open, used] = await Promise.all([
      this.prisma.client.user.findUniqueOrThrow({
        where: { id: userId },
        select: { kycStatus: true },
      }),
      this.prisma.client.trade.count({
        where: { OR: [{ buyerId: userId }, { sellerId: userId }], status: { in: [...OPEN] } },
      }),
      this.dailyTotal(userId),
    ]);
    const ceiling = BigInt(tierFor(user.kycStatus).dailyTradeUsd) * 1_000_000n;
    if (used + amount > ceiling) {
      const left = ceiling > used ? ceiling - used : 0n;
      throw taker
        ? AppError.validation([
            {
              path: "amount",
              message: `That is over your daily trading limit. You have ${formatUsdt(left)} USDT left today.`,
            },
          ])
        : AppError.conflict(
            "This advertiser has reached their daily trading limit. Try another offer.",
          );
    }
    if (open >= this.env.TRADE_MAX_OPEN_PER_USER) {
      throw taker
        ? AppError.conflict(`You have ${open} trades open. Finish one before opening another.`)
        : AppError.conflict("This advertiser has too many trades open right now. Try again later.");
    }
  }

  /** Millionths traded in the last 24 hours that did not come back: open or completed, either side. */
  private async dailyTotal(userId: string): Promise<bigint> {
    const rows = await this.prisma.client.trade.findMany({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
        createdAt: { gte: new Date(Date.now() - 24 * HOUR_MS) },
        status: { notIn: ["CANCELLED", "EXPIRED", "REFUNDED"] },
      },
      select: { amount: true },
    });
    return rows.reduce((sum, row) => sum + row.amount, 0n);
  }

  /** Step-up for the one act that hands money over (state-machines.md 3, "release"). */
  private async assertPassword(userId: string, password: string): Promise<void> {
    const identity = await this.prisma.client.authIdentity.findUnique({
      where: { userId_provider: { userId, provider: "PASSWORD" } },
      select: { passwordHash: true },
    });
    if (!identity?.passwordHash) {
      throw AppError.forbidden("Set a password on your account before releasing a trade.");
    }
    if (!(await verifyPassword(identity.passwordHash, password))) {
      throw AppError.validation([{ path: "password", message: "That password is not right." }]);
    }
  }

  /** The trade, locked for the rest of the transaction - if this customer is a party to it. */
  private async lockParty(tx: Tx, userId: string, id: string): Promise<TradeRow> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM trades
       WHERE id = ${id} AND (buyer_id = ${userId} OR seller_id = ${userId})
         FOR UPDATE`;
    if (!rows[0]) throw AppError.notFound("There is no such trade.");
    return tx.trade.findUniqueOrThrow({ where: { id }, include: WITH });
  }

  /*
    The one place the escrow empties. Every path - release, cancel, expiry,
    an administrator's decision - posts through here under the same
    idempotency key, so a second settlement of the same trade is a conflict
    the ledger refuses rather than a second movement (AT-5, AT-7). One that
    is not a sale also gives the offer its amount back - and before the
    ledger is touched, because opening a trade takes the offer before the
    seller's balance, and a refund taking them the other way round could
    deadlock with a take on the same offer.
  */
  async settle(tx: Tx, trade: TradeRow, settlement: Settlement): Promise<PostedTransaction> {
    assertTradeTransition(trade.status, settlement.to);
    if (settlement.to !== "COMPLETED") {
      await this.offers.restore(tx, trade.offerId, trade.amount);
    }
    const posted = await this.ledger.postIn(tx, {
      reason: settlement.reason,
      asset: "USDT",
      reference: { type: SUBJECT, id: trade.id },
      actor: settlement.actor,
      correlationId: trade.correlationId,
      idempotencyKey: `trade:${trade.id}:settle`,
      ...(settlement.reversesTransactionId
        ? { reversesTransactionId: settlement.reversesTransactionId }
        : {}),
      lines: settlement.lines,
    });
    await tx.trade.update({
      where: { id: trade.id },
      data: {
        status: settlement.to,
        closedAt: new Date(),
        closeReason: settlement.closeReason,
        settlementTransactionId: posted.id,
      },
    });
    this.changed(trade, settlement.to);
    return posted;
  }

  /** The marketplace's counters, moved in the same transaction as the trade. Rows in id order, so two trades between the same two people cannot deadlock here. */
  async bumpStats(
    tx: Tx,
    userIds: readonly string[],
    delta: {
      tradesTotal?: number;
      tradesCompleted?: number;
      tradesFailed?: number;
      releaseMs?: bigint;
      payMs?: bigint;
    },
  ): Promise<void> {
    for (const userId of [...new Set(userIds)].sort()) {
      await tx.$executeRaw`
        INSERT INTO trader_stats
          (user_id, trades_total, trades_completed, trades_failed,
           release_total_ms, release_count, pay_total_ms, pay_count, "updatedAt")
        VALUES (${userId}, ${delta.tradesTotal ?? 0}::int, ${delta.tradesCompleted ?? 0}::int,
                ${delta.tradesFailed ?? 0}::int, ${delta.releaseMs ?? 0n}::bigint,
                ${delta.releaseMs !== undefined ? 1 : 0}::int, ${delta.payMs ?? 0n}::bigint,
                ${delta.payMs !== undefined ? 1 : 0}::int, now())
        ON CONFLICT (user_id) DO UPDATE SET
          trades_total = trader_stats.trades_total + EXCLUDED.trades_total,
          trades_completed = trader_stats.trades_completed + EXCLUDED.trades_completed,
          trades_failed = trader_stats.trades_failed + EXCLUDED.trades_failed,
          release_total_ms = trader_stats.release_total_ms + EXCLUDED.release_total_ms,
          release_count = trader_stats.release_count + EXCLUDED.release_count,
          pay_total_ms = trader_stats.pay_total_ms + EXCLUDED.pay_total_ms,
          pay_count = trader_stats.pay_count + EXCLUDED.pay_count,
          "updatedAt" = now()`;
    }
  }

  /** A party is told, in the app and by email, through the outbox, in the same transaction. */
  async tell(
    tx: Tx,
    input: {
      userId: string;
      type: NotificationType;
      title: string;
      body: string;
      tradeId: string;
      mail: Omit<Parameters<typeof tradeMail>[1], "to" | "appName"> & { kind: TradeMailKind };
      correlationId: string;
    },
  ): Promise<void> {
    await this.notifications.notify(
      {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        link: `/orders/${input.tradeId}`,
      },
      tx,
    );
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { email: true } });
    if (!user) return;
    const { kind, ...rest } = input.mail;
    const mail: Mail = tradeMail(kind, { ...rest, to: user.email, appName: this.env.APP_NAME });
    await this.outbox.enqueue(tx, {
      type: EMAIL_EVENT,
      payload: { ...mail },
      correlationId: input.correlationId,
    });
  }

  private async toViews(rows: TradeRow[], viewerId: string): Promise<TradeView[]> {
    if (rows.length === 0) return [];
    const others = [
      ...new Set(rows.map((row) => (row.buyerId === viewerId ? row.sellerId : row.buyerId))),
    ];
    const [users, stats] = await Promise.all([
      this.prisma.client.user.findMany({
        where: { id: { in: others } },
        select: { id: true, username: true, kycStatus: true },
      }),
      this.prisma.client.traderStats.findMany({ where: { userId: { in: others } } }),
    ]);
    const statsOf = new Map(stats.map((row) => [row.userId, row]));
    return rows.map((row) => {
      const otherId = row.buyerId === viewerId ? row.sellerId : row.buyerId;
      const user = users.find((candidate) => candidate.id === otherId);
      return this.toView(row, viewerId, {
        userId: otherId,
        username: user?.username ?? "a former customer",
        verified: user?.kycStatus === "APPROVED",
        ...statsView(statsOf.get(otherId) ?? null),
      });
    });
  }

  private toView(row: TradeRow, viewerId: string, counterparty: AdvertiserView): TradeView {
    const role: TradeRole = row.buyerId === viewerId ? "BUYER" : "SELLER";
    const open = isOpen(row.status);
    const now = Date.now();
    const cooldownOver =
      row.paidAt !== null &&
      now - row.paidAt.getTime() >= this.env.TRADE_DISPUTE_COOLDOWN_MINUTES * 60_000;
    const chatOpen =
      open ||
      (row.closedAt !== null &&
        now - row.closedAt.getTime() < this.env.TRADE_CHAT_AFTER_CLOSE_HOURS * HOUR_MS);
    const dispute = row.dispute;
    const paidEvent = row.events[0];
    const reference =
      paidEvent &&
      paidEvent.data &&
      typeof paidEvent.data === "object" &&
      !Array.isArray(paidEvent.data)
        ? ((paidEvent.data as { reference?: unknown }).reference ?? null)
        : null;

    return {
      id: row.id,
      offerId: row.offerId,
      offerSide: row.offerSide,
      role,
      status: row.status,
      message: messageFor(row.status, role),
      asset: row.asset,
      amount: row.amount.toString(),
      fee: row.fee.toString(),
      buyerReceives: (row.amount - row.fee).toString(),
      fiat: row.fiat,
      priceSantim: row.priceSantim.toString(),
      fiatSantim: row.fiatSantim.toString(),
      counterparty,
      payment: {
        kind: row.paymentKind,
        label: row.paymentLabel,
        // The seller's own, always; the buyer's while there is a payment to make.
        instructions:
          role === "SELLER" || open
            ? this.cipher.decrypt(row.paymentSnapshotEncrypted, TRADE_SNAPSHOT_PURPOSE)
            : null,
        reference: typeof reference === "string" ? reference : null,
      },
      paymentDeadline: row.paymentDeadline.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      closeReason: row.closeReason,
      dispute: dispute
        ? {
            id: dispute.id,
            status: dispute.status,
            reason: dispute.reason,
            openedByMe: dispute.openedById === viewerId,
            outcome: dispute.outcome,
            resolutionNote: dispute.resolutionNote,
            createdAt: dispute.createdAt.toISOString(),
            resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
          }
        : null,
      chat: {
        lastSeq: row.chatSeq,
        unread: Math.max(
          0,
          row.chatSeq - (row.reads.find((read) => read.userId === viewerId)?.lastReadSeq ?? 0),
        ),
      },
      actions: {
        canMarkPaid: role === "BUYER" && row.status === "AWAITING_FIAT_PAYMENT",
        canCancel: role === "BUYER" && row.status === "AWAITING_FIAT_PAYMENT",
        canRelease:
          role === "SELLER" && (row.status === "BUYER_MARKED_PAID" || row.status === "DISPUTED"),
        canDispute: row.status === "BUYER_MARKED_PAID" && cooldownOver,
        canWithdrawDispute:
          row.status === "DISPUTED" &&
          dispute?.status === "OPEN" &&
          dispute.openedById === viewerId,
        canChat: chatOpen,
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/* --------------------------------------------------------------- helpers */

/** The track record beside a name, from the counters. Shared shape with the marketplace. */
export function statsView(
  stats: TraderStats | null,
): Pick<
  AdvertiserView,
  "tradesTotal" | "tradesCompleted" | "completionRate" | "avgReleaseSeconds" | "avgPaySeconds"
> {
  const total = stats?.tradesTotal ?? 0;
  const completed = stats?.tradesCompleted ?? 0;
  const average = (totalMs: bigint, count: number) =>
    count > 0 ? Math.round(Number(totalMs) / count / 1_000) : null;
  return {
    tradesTotal: total,
    tradesCompleted: completed,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : null,
    avgReleaseSeconds: stats ? average(stats.releaseTotalMs, stats.releaseCount) : null,
    avgPaySeconds: stats ? average(stats.payTotalMs, stats.payCount) : null,
  };
}
