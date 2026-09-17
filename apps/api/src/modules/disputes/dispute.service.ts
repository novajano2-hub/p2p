import {
  DISPUTE_EVIDENCE_MAX_BYTES,
  DISPUTE_EVIDENCE_MAX_PER_PARTY,
  DISPUTE_REASONS,
  type AdminDisputeDetail,
  type AdminDisputeItem,
  type AdminDisputeParty,
  type AdminDisputeQueueResponse,
  type AdminTradeEvent,
  type DisputeEvidenceView,
  type DisputeView,
  type OpenDisputeRequest,
  type ResolveDisputeRequest,
  type TradeRole,
} from "@abay/contracts";
import { type Dispute, type DisputeEvidence, type Prisma, type TradeEvent } from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { v7 as uuidv7 } from "uuid";

import { AppError } from "@/common/errors/app-error";
import { formatUsdt } from "@/common/money/units";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { OBJECT_STORE, StorageError, type ObjectStore } from "@/infra/storage/object-store";
import { type AdminSessionContext } from "@/modules/admin/admin-session.service";
import { AuditService } from "@/modules/audit/audit.service";
import { ChatService } from "@/modules/chat/chat.service";
import { CustomerDirectoryService } from "@/modules/customers/customer-directory.service";
import { IMAGE_EXTENSIONS, sniffImageType } from "@/modules/kyc/image-type";
import { accounts } from "@/modules/ledger/account-code";
import {
  PaymentDetailsCipher,
  TRADE_SNAPSHOT_PURPOSE,
} from "@/modules/payment-methods/payment-details.cipher";
import { assertTradeTransition } from "@/modules/trades/trade.machine";
import { TradeService, WITH, type TradeRow } from "@/modules/trades/trade.service";

/*
  Disputes: the DISPUTED rows of state-machines.md 3.

  Once the buyer has said "I have paid", either party may ask a person to
  look. The escrow stays exactly where it is while they do; the only things
  that change are a status, a row that records who asked and why, and what
  each side attaches. It ends one of three ways: the party who opened it
  takes it back, the seller releases after all (trade.service.ts), or an
  administrator with the DISPUTE_RESOLVER role decides - through the same
  settle() every other closing path uses, so the money moves once and the
  ledger cannot tell a decision from a release or a refund. What can tell
  them apart is everything around it: the actor, the mandatory note, the
  evidence the decision cites, and the audit event that carries all of it
  (AT-8).

  A trade a customer is not party to has no dispute as far as they can
  tell (AT-6). Evidence is readable by the two parties and the resolver,
  through the dispute and never by key (threat model B5.2).
*/

const SUBJECT = "dispute";

type Tx = Prisma.TransactionClient;

interface Context {
  correlationId: string;
  ip?: string | undefined;
}

/** The two people a dispute is between. */
interface Parties {
  buyerId: string;
  sellerId: string;
}

const EVIDENCE_WITH = {
  evidence: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.DisputeInclude;
type DisputeRow = Prisma.DisputeGetPayload<{ include: typeof EVIDENCE_WITH }>;

/** A dispute as the resolver's list needs it: the trade, the payment reference, how many files. */
const ADMIN_WITH = {
  _count: { select: { evidence: true } },
  trade: { include: { events: { where: { kind: "MARKED_PAID" as const }, take: 1 } } },
} satisfies Prisma.DisputeInclude;
type AdminRow = Prisma.DisputeGetPayload<{ include: typeof ADMIN_WITH }>;

@Injectable()
export class DisputeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    private readonly cipher: PaymentDetailsCipher,
    private readonly trades: TradeService,
    private readonly chat: ChatService,
    private readonly customers: CustomerDirectoryService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DisputeService.name);
  }

  /* ------------------------------------------------------------- parties */

  async viewFor(userId: string, tradeId: string): Promise<DisputeView> {
    const trade = await this.party(userId, tradeId);
    const dispute = await this.prisma.client.dispute.findUnique({
      where: { tradeId },
      include: EVIDENCE_WITH,
    });
    if (!dispute) throw AppError.notFound("There is no dispute on this trade.");
    return toView(dispute, trade, userId);
  }

  /**
   * Asking a person to look. Either party, from BUYER_MARKED_PAID only, and
   * only once the payment has had time to arrive. A trade has one dispute
   * row; a withdrawn one is rewritten rather than joined by a second.
   */
  async open(
    userId: string,
    tradeId: string,
    input: OpenDisputeRequest,
    context: Context,
  ): Promise<DisputeView> {
    const { row, trade } = await this.prisma.transaction("dispute:open", async (tx) => {
      const trade = await this.lockParty(tx, userId, tradeId);
      assertTradeTransition(trade.status, "DISPUTED");
      this.assertCooldownOver(trade);
      const reopened = trade.dispute !== null;
      const role = roleOf(trade, userId);

      const row = await tx.dispute.upsert({
        where: { tradeId },
        create: {
          tradeId,
          openedById: userId,
          reason: input.reason,
          description: input.description,
          correlationId: context.correlationId,
        },
        update: {
          status: "OPEN",
          openedById: userId,
          reason: input.reason,
          description: input.description,
          outcome: null,
          resolutionNote: null,
          resolvedById: null,
          resolvedByEmail: null,
          resolvedAt: null,
          withdrawnAt: null,
          correlationId: context.correlationId,
        },
        include: EVIDENCE_WITH,
      });
      await tx.trade.update({ where: { id: tradeId }, data: { status: "DISPUTED" } });
      await tx.tradeEvent.create({
        data: {
          tradeId,
          kind: "DISPUTE_OPENED",
          actorUserId: userId,
          data: { reason: input.reason, reopened },
        },
      });
      await this.audit.record(
        {
          action: "dispute.opened",
          actor: null,
          subject: { type: SUBJECT, id: row.id },
          reason: input.reason,
          before: { tradeStatus: trade.status },
          after: { tradeStatus: "DISPUTED", openedBy: role, reopened },
          correlationId: context.correlationId,
          ip: context.ip ?? null,
        },
        tx,
      );

      const opener = await this.username(tx, userId);
      await this.trades.tell(tx, {
        userId: other(trade, userId),
        type: "DISPUTE_OPENED",
        title: "A dispute was opened on your trade",
        body: `${opener} opened a dispute: ${DISPUTE_REASONS[input.reason]}. Attach anything that shows what happened; a reviewer reads the chat and the evidence from both sides.`,
        tradeId,
        mail: {
          kind: "DISPUTED",
          role: role === "BUYER" ? "SELLER" : "BUYER",
          amount: trade.amount,
          fiatSantim: trade.fiatSantim,
          counterparty: opener,
        },
        correlationId: context.correlationId,
      });
      this.trades.changed(trade, "DISPUTED");
      return { row, trade };
    });
    this.logger.info(
      { event: "dispute.opened", tradeId, disputeId: row.id, correlationId: context.correlationId },
      "dispute opened",
    );
    return toView(row, trade, userId);
  }

  /** Taking it back. The party who opened it, only; the trade goes back to waiting for the seller. */
  async withdraw(userId: string, tradeId: string, context: Context): Promise<DisputeView> {
    const { row, trade } = await this.prisma.transaction("dispute:withdraw", async (tx) => {
      const trade = await this.lockParty(tx, userId, tradeId);
      const dispute = trade.dispute;
      if (dispute?.status !== "OPEN") {
        throw AppError.conflict("There is no open dispute on this trade.");
      }
      if (dispute.openedById !== userId) {
        throw AppError.forbidden("Only the party who opened the dispute can withdraw it.");
      }
      assertTradeTransition(trade.status, "BUYER_MARKED_PAID");

      const row = await tx.dispute.update({
        where: { id: dispute.id },
        data: { status: "WITHDRAWN", withdrawnAt: new Date() },
        include: EVIDENCE_WITH,
      });
      await tx.trade.update({ where: { id: tradeId }, data: { status: "BUYER_MARKED_PAID" } });
      await tx.tradeEvent.create({
        data: { tradeId, kind: "DISPUTE_WITHDRAWN", actorUserId: userId },
      });
      await this.audit.record(
        {
          action: "dispute.withdrawn",
          actor: null,
          subject: { type: SUBJECT, id: dispute.id },
          before: { tradeStatus: trade.status, disputeStatus: "OPEN" },
          after: { tradeStatus: "BUYER_MARKED_PAID", disputeStatus: "WITHDRAWN" },
          correlationId: context.correlationId,
          ip: context.ip ?? null,
        },
        tx,
      );

      const role = roleOf(trade, userId);
      const who = await this.username(tx, userId);
      await this.trades.tell(tx, {
        userId: other(trade, userId),
        type: "DISPUTE_WITHDRAWN",
        title: "The dispute on your trade was withdrawn",
        body:
          role === "BUYER"
            ? `${who} withdrew the dispute. The trade is back to waiting for you to release once the money has arrived.`
            : `${who} withdrew the dispute. The trade is back to waiting for the seller to release.`,
        tradeId,
        mail: {
          kind: "DISPUTE_WITHDRAWN",
          role: role === "BUYER" ? "SELLER" : "BUYER",
          amount: trade.amount,
          fiatSantim: trade.fiatSantim,
          counterparty: who,
        },
        correlationId: context.correlationId,
      });
      this.trades.changed(trade, "BUYER_MARKED_PAID");
      return { row, trade };
    });
    return toView(row, trade, userId);
  }

  /*
    A screenshot. The bytes go to the store before the transaction opens -
    a bucket write must not run under a row lock (AT-19) - and are removed
    again if the row cannot be written. The cap per party is counted under
    the trade's lock, so two uploads racing cannot both be the fifth.
  */
  async addEvidence(
    userId: string,
    tradeId: string,
    bytes: Buffer,
    note: string | null,
    context: Context,
  ): Promise<DisputeEvidenceView> {
    const trade = await this.party(userId, tradeId);
    if (trade.dispute?.status !== "OPEN") {
      throw AppError.conflict("There is no open dispute to attach this to.");
    }
    const contentType = sniffImageType(bytes);
    if (!contentType) {
      throw AppError.validation(
        [{ path: "file", message: "That file is not a JPEG, PNG or WebP image." }],
        "Send the image as a JPEG, PNG or WebP.",
      );
    }
    if (bytes.length > DISPUTE_EVIDENCE_MAX_BYTES) {
      throw AppError.validation(
        [
          {
            path: "file",
            message: `Files must be under ${DISPUTE_EVIDENCE_MAX_BYTES / 1024 / 1024} MB.`,
          },
        ],
        "That file is too large.",
      );
    }
    if (
      (await this.attachedBy(this.prisma.client, trade.dispute.id, userId)) >=
      DISPUTE_EVIDENCE_MAX_PER_PARTY
    ) {
      throw tooMany();
    }

    const key = `trades/${tradeId}/dispute/${uuidv7()}.${IMAGE_EXTENSIONS[contentType]}`;
    try {
      await this.store.put({ key, body: bytes, contentType });
    } catch (error) {
      if (error instanceof StorageError) {
        throw AppError.notReady("We could not save the file right now. Please try again.");
      }
      throw error;
    }

    let row: DisputeEvidence;
    try {
      row = await this.prisma.transaction("dispute:evidence", async (tx) => {
        const locked = await this.lockParty(tx, userId, tradeId);
        if (locked.dispute?.status !== "OPEN") {
          throw AppError.conflict("There is no open dispute to attach this to.");
        }
        if (
          (await this.attachedBy(tx, locked.dispute.id, userId)) >= DISPUTE_EVIDENCE_MAX_PER_PARTY
        ) {
          throw tooMany();
        }
        const created = await tx.disputeEvidence.create({
          data: {
            disputeId: locked.dispute.id,
            uploadedById: userId,
            storageKey: key,
            contentType,
            sizeBytes: bytes.length,
            note,
          },
        });
        await this.audit.record(
          {
            action: "dispute.evidence_added",
            actor: null,
            subject: { type: SUBJECT, id: locked.dispute.id },
            after: {
              evidenceId: created.id,
              by: roleOf(locked, userId),
              contentType,
              sizeBytes: bytes.length,
            },
            correlationId: context.correlationId,
            ip: context.ip ?? null,
          },
          tx,
        );
        return created;
      });
    } catch (error) {
      await this.discard(key);
      throw error;
    }
    return toEvidence(row, trade);
  }

  /** The bytes of one file, to a party of the trade only. */
  async evidence(
    userId: string,
    tradeId: string,
    evidenceId: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    await this.party(userId, tradeId);
    return this.evidenceBytes(tradeId, evidenceId);
  }

  /* --------------------------------------------------------------- admin */

  async queue(): Promise<AdminDisputeQueueResponse> {
    const [open, recent] = await Promise.all([
      this.prisma.client.dispute.findMany({
        where: { status: "OPEN" },
        orderBy: { createdAt: "asc" },
        include: ADMIN_WITH,
        take: 200,
      }),
      this.prisma.client.dispute.findMany({
        where: { status: { in: ["RESOLVED", "WITHDRAWN"] } },
        orderBy: { updatedAt: "desc" },
        include: ADMIN_WITH,
        take: 20,
      }),
    ]);
    const items = await this.toAdminItems([...open, ...recent]);
    return { open: items.slice(0, open.length), recent: items.slice(open.length) };
  }

  async adminItem(id: string): Promise<AdminDisputeItem> {
    const row = await this.prisma.client.dispute.findUnique({ where: { id }, include: ADMIN_WITH });
    if (!row) throw AppError.notFound("There is no such dispute.");
    const [item] = await this.toAdminItems([row]);
    if (!item) throw AppError.notFound("There is no such dispute.");
    return item;
  }

  /**
   * Everything the resolver may weigh, in one place: the trade, both parties'
   * records, the payment details the buyer was shown, the chat, the files,
   * and the timeline. Looking is recorded (threat model B7.5).
   */
  async detail(
    id: string,
    session: AdminSessionContext,
    context: Context,
  ): Promise<AdminDisputeDetail> {
    const row = await this.prisma.client.dispute.findUnique({
      where: { id },
      include: { ...ADMIN_WITH, ...EVIDENCE_WITH },
    });
    if (!row) throw AppError.notFound("There is no such dispute.");
    const [item] = await this.toAdminItems([row]);
    if (!item) throw AppError.notFound("There is no such dispute.");
    const [messages, events] = await Promise.all([
      this.chat.transcript(row.tradeId),
      this.prisma.client.tradeEvent.findMany({
        where: { tradeId: row.tradeId },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    await this.audit.record({
      action: "dispute.viewed",
      actor: { id: session.admin.id, email: session.admin.email },
      subject: { type: SUBJECT, id },
      correlationId: context.correlationId,
      ip: context.ip ?? null,
    });
    return {
      ...item,
      payment: {
        kind: row.trade.paymentKind,
        label: row.trade.paymentLabel,
        instructions: this.cipher.decrypt(
          row.trade.paymentSnapshotEncrypted,
          TRADE_SNAPSHOT_PURPOSE,
          row.trade.paymentKind,
        ),
      },
      evidence: row.evidence.map((file) => toEvidence(file, row.trade)),
      messages,
      events: events.map((event) => toAdminEvent(event, row.trade)),
    };
  }

  async adminEvidence(
    id: string,
    evidenceId: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    const dispute = await this.prisma.client.dispute.findUnique({
      where: { id },
      select: { tradeId: true },
    });
    if (!dispute) return null;
    return this.evidenceBytes(dispute.tradeId, evidenceId);
  }

  async adminChatImage(
    id: string,
    messageId: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    const dispute = await this.prisma.client.dispute.findUnique({
      where: { id },
      select: { tradeId: true },
    });
    if (!dispute) return null;
    return this.chat.imageBytes(dispute.tradeId, messageId);
  }

  /**
   * The decision. One settlement through the trade engine, so the escrow
   * moves exactly once whichever way it goes and a second decision finds a
   * trade that is already closed (AT-5, AT-7). For the buyer it is the
   * release shape (JE-6); for the seller the refund shape (JE-5),
   * reversing the lock by id. Both parties get the note, word for word.
   */
  async resolve(
    id: string,
    input: ResolveDisputeRequest,
    session: AdminSessionContext,
    context: Context,
  ): Promise<AdminDisputeItem> {
    await this.prisma.transaction("dispute:resolve", async (tx) => {
      const { dispute, trade } = await this.lockDispute(tx, id);
      if (dispute.status !== "OPEN") {
        throw AppError.conflict("This dispute has already been decided or withdrawn.");
      }
      const toBuyer = input.outcome === "RELEASE_TO_BUYER";
      const receives = trade.amount - trade.fee;
      const actor = { type: "ADMIN" as const, id: session.admin.id };

      await this.trades.settle(
        tx,
        trade,
        toBuyer
          ? {
              to: "COMPLETED",
              reason: "DISPUTE_RESOLVED_RELEASE",
              lines: [
                {
                  account: accounts.tradeEscrow(trade.id),
                  direction: "DEBIT",
                  amount: trade.amount,
                },
                {
                  account: accounts.userAvailable(trade.buyerId),
                  direction: "CREDIT",
                  amount: receives,
                },
                {
                  account: accounts.platform("TRADE_FEES"),
                  direction: "CREDIT",
                  amount: trade.fee,
                },
              ],
              actor,
              closeReason: `Decided for the buyer: ${input.note}`,
            }
          : {
              to: "REFUNDED",
              reason: "DISPUTE_RESOLVED_REFUND",
              lines: [
                {
                  account: accounts.tradeEscrow(trade.id),
                  direction: "DEBIT",
                  amount: trade.amount,
                },
                {
                  account: accounts.userAvailable(trade.sellerId),
                  direction: "CREDIT",
                  amount: trade.amount,
                },
              ],
              actor,
              reversesTransactionId: trade.escrowTransactionId ?? undefined,
              closeReason: `Decided for the seller: ${input.note}`,
            },
      );
      await tx.dispute.update({
        where: { id },
        data: {
          status: "RESOLVED",
          outcome: input.outcome,
          resolvedById: session.admin.id,
          resolvedByEmail: session.admin.email,
          resolutionNote: input.note,
          resolvedAt: new Date(),
        },
      });
      await tx.tradeEvent.create({
        data: {
          tradeId: trade.id,
          kind: "DISPUTE_RESOLVED",
          actorAdminId: session.admin.id,
          data: { outcome: input.outcome },
        },
      });
      if (toBuyer) {
        await this.trades.bumpStats(tx, [trade.buyerId, trade.sellerId], { tradesCompleted: 1 });
      } else {
        await this.trades.bumpStats(tx, [trade.buyerId], { tradesFailed: 1 });
      }

      const evidenceIds = (
        await tx.disputeEvidence.findMany({
          where: { disputeId: id },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        })
      ).map((file) => file.id);
      await this.audit.record(
        {
          action: toBuyer ? "dispute.resolved_release" : "dispute.resolved_refund",
          actor: { id: session.admin.id, email: session.admin.email },
          subject: { type: SUBJECT, id },
          reason: input.note,
          before: {
            tradeStatus: trade.status,
            disputeStatus: "OPEN",
            reason: dispute.reason,
            openedBy: roleOf(trade, dispute.openedById),
          },
          after: {
            tradeStatus: toBuyer ? "COMPLETED" : "REFUNDED",
            outcome: input.outcome,
            buyerReceives: toBuyer ? receives.toString() : "0",
            sellerRefund: toBuyer ? "0" : trade.amount.toString(),
            evidenceIds,
          },
          correlationId: context.correlationId,
          ip: context.ip ?? null,
        },
        tx,
      );

      const names = await this.usernames(tx, [trade.buyerId, trade.sellerId]);
      const moved = toBuyer
        ? `${formatUsdt(receives)} USDT was released to the buyer.`
        : `${formatUsdt(trade.amount)} USDT went back to the seller.`;
      for (const [userId, role, counterpart] of [
        [trade.buyerId, "BUYER", trade.sellerId],
        [trade.sellerId, "SELLER", trade.buyerId],
      ] as const) {
        const won = toBuyer === (role === "BUYER");
        await this.trades.tell(tx, {
          userId,
          type: "DISPUTE_RESOLVED",
          title: won
            ? "The dispute was decided in your favour"
            : "The dispute was decided against you",
          body: `${moved} The reviewer wrote: ${input.note}`,
          tradeId: trade.id,
          mail: {
            kind: "DECIDED",
            role,
            amount: toBuyer ? receives : trade.amount,
            fiatSantim: trade.fiatSantim,
            counterparty: names.get(counterpart) ?? "the other party",
            outcome: input.outcome,
          },
          correlationId: context.correlationId,
        });
      }
    });
    this.logger.info(
      {
        event: "dispute.resolved",
        disputeId: id,
        outcome: input.outcome,
        adminId: session.admin.id,
        correlationId: context.correlationId,
      },
      "dispute resolved",
    );
    return this.adminItem(id);
  }

  /* ------------------------------------------------------------- plumbing */

  /**
   * A bank transfer takes a while to show. A dispute opened the second after
   * "I have paid" is noise for the reviewer and pressure on the seller, so
   * both sides wait the same few minutes.
   */
  private assertCooldownOver(trade: { paidAt: Date | null }): void {
    const cooldownMs = this.env.TRADE_DISPUTE_COOLDOWN_MINUTES * 60_000;
    const since = trade.paidAt ? Date.now() - trade.paidAt.getTime() : 0;
    if (since >= cooldownMs) return;
    const minutes = Math.max(1, Math.ceil((cooldownMs - since) / 60_000));
    throw AppError.conflict(
      `Give the payment ${this.env.TRADE_DISPUTE_COOLDOWN_MINUTES} minutes to arrive first. You can open a dispute in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }

  private attachedBy(
    reader: Pick<Tx, "disputeEvidence">,
    disputeId: string,
    userId: string,
  ): Promise<number> {
    return reader.disputeEvidence.count({ where: { disputeId, uploadedById: userId } });
  }

  private async evidenceBytes(
    tradeId: string,
    evidenceId: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    const file = await this.prisma.client.disputeEvidence.findFirst({
      where: { id: evidenceId, dispute: { tradeId } },
      select: { storageKey: true, contentType: true },
    });
    if (!file) return null;
    let body: Buffer | null;
    try {
      body = await this.store.get(file.storageKey);
    } catch (error) {
      if (error instanceof StorageError) {
        throw AppError.notReady("We could not load that file right now. Please try again.");
      }
      throw error;
    }
    return body ? { body, contentType: file.contentType } : null;
  }

  /** The trade, if this customer is a party to it. Otherwise it does not exist. */
  private async party(userId: string, tradeId: string): Promise<TradeRow> {
    const trade = await this.prisma.client.trade.findFirst({
      where: { id: tradeId, OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: WITH,
    });
    if (!trade) throw AppError.notFound("There is no such trade.");
    return trade;
  }

  /** The same, locked for the rest of the transaction. */
  private async lockParty(tx: Tx, userId: string, tradeId: string): Promise<TradeRow> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM trades
       WHERE id = ${tradeId} AND (buyer_id = ${userId} OR seller_id = ${userId})
         FOR UPDATE`;
    if (!rows[0]) throw AppError.notFound("There is no such trade.");
    return tx.trade.findUniqueOrThrow({ where: { id: tradeId }, include: WITH });
  }

  /** The trade behind a dispute, locked, for the resolver. Lock order: the trade first, as everywhere. */
  private async lockDispute(tx: Tx, id: string): Promise<{ dispute: Dispute; trade: TradeRow }> {
    const found = await tx.dispute.findUnique({ where: { id }, select: { tradeId: true } });
    if (!found) throw AppError.notFound("There is no such dispute.");
    await tx.$queryRaw`SELECT id FROM trades WHERE id = ${found.tradeId} FOR UPDATE`;
    const trade = await tx.trade.findUniqueOrThrow({ where: { id: found.tradeId }, include: WITH });
    const dispute = await tx.dispute.findUniqueOrThrow({ where: { id } });
    return { dispute, trade };
  }

  private async toAdminItems(rows: AdminRow[]): Promise<AdminDisputeItem[]> {
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.flatMap((row) => [row.trade.buyerId, row.trade.sellerId]))];
    const [customers, stats] = await Promise.all([
      this.customers.summaries(ids),
      this.prisma.client.traderStats.findMany({ where: { userId: { in: ids } } }),
    ]);
    const statsOf = new Map(stats.map((row) => [row.userId, row]));
    const party = (userId: string): AdminDisputeParty => ({
      customer: customers.get(userId) ?? null,
      tradesTotal: statsOf.get(userId)?.tradesTotal ?? 0,
      tradesCompleted: statsOf.get(userId)?.tradesCompleted ?? 0,
      tradesFailed: statsOf.get(userId)?.tradesFailed ?? 0,
    });
    return rows.map((row) => {
      const trade = row.trade;
      const paid = trade.events[0];
      const reference =
        paid && paid.data && typeof paid.data === "object" && !Array.isArray(paid.data)
          ? ((paid.data as { reference?: unknown }).reference ?? null)
          : null;
      return {
        id: row.id,
        status: row.status,
        reason: row.reason,
        description: row.description,
        openedBy: roleOf(trade, row.openedById),
        outcome: row.outcome,
        resolutionNote: row.resolutionNote,
        resolvedByEmail: row.resolvedByEmail,
        evidenceCount: row._count.evidence,
        createdAt: row.createdAt.toISOString(),
        withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        correlationId: row.correlationId,
        trade: {
          id: trade.id,
          offerSide: trade.offerSide,
          status: trade.status,
          amount: trade.amount.toString(),
          fee: trade.fee.toString(),
          priceSantim: trade.priceSantim.toString(),
          fiatSantim: trade.fiatSantim.toString(),
          paymentKind: trade.paymentKind,
          paymentLabel: trade.paymentLabel,
          paymentReference: typeof reference === "string" ? reference : null,
          createdAt: trade.createdAt.toISOString(),
          paidAt: trade.paidAt?.toISOString() ?? null,
          paymentDeadline: trade.paymentDeadline.toISOString(),
          closedAt: trade.closedAt?.toISOString() ?? null,
          closeReason: trade.closeReason,
        },
        buyer: party(trade.buyerId),
        seller: party(trade.sellerId),
      };
    });
  }

  private async username(tx: Tx, userId: string): Promise<string> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { username: true },
    });
    return user.username;
  }

  private async usernames(tx: Tx, userIds: string[]): Promise<Map<string, string>> {
    const users = await tx.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true },
    });
    return new Map(users.map((user) => [user.id, user.username]));
  }

  private async discard(key: string): Promise<void> {
    try {
      await this.store.delete(key);
    } catch (error) {
      this.logger.warn(
        { event: "dispute.evidence_discard_failed", key, err: error },
        "a file was left in the store",
      );
    }
  }
}

/* --------------------------------------------------------------- helpers */

const roleOf = (trade: Parties, userId: string): TradeRole =>
  trade.buyerId === userId ? "BUYER" : "SELLER";

const other = (trade: Parties, userId: string): string =>
  trade.buyerId === userId ? trade.sellerId : trade.buyerId;

const tooMany = (): AppError =>
  AppError.validation(
    [{ path: "file", message: `You can attach up to ${DISPUTE_EVIDENCE_MAX_PER_PARTY} files.` }],
    "That is as many files as one side may attach.",
  );

function toEvidence(file: DisputeEvidence, trade: Parties): DisputeEvidenceView {
  return {
    id: file.id,
    uploadedBy: roleOf(trade, file.uploadedById),
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    note: file.note,
    createdAt: file.createdAt.toISOString(),
  };
}

function toView(dispute: DisputeRow, trade: Parties, viewerId: string): DisputeView {
  const mine = dispute.evidence.filter((file) => file.uploadedById === viewerId).length;
  return {
    id: dispute.id,
    tradeId: dispute.tradeId,
    status: dispute.status,
    reason: dispute.reason,
    description: dispute.description,
    openedBy: roleOf(trade, dispute.openedById),
    openedByMe: dispute.openedById === viewerId,
    outcome: dispute.outcome,
    resolutionNote: dispute.resolutionNote,
    evidence: dispute.evidence.map((file) => toEvidence(file, trade)),
    evidenceLeft:
      dispute.status === "OPEN" ? Math.max(0, DISPUTE_EVIDENCE_MAX_PER_PARTY - mine) : 0,
    createdAt: dispute.createdAt.toISOString(),
    withdrawnAt: dispute.withdrawnAt?.toISOString() ?? null,
    resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
  };
}

function toAdminEvent(event: TradeEvent, trade: Parties): AdminTradeEvent {
  return {
    id: event.id,
    kind: event.kind,
    actor: event.actorAdminId
      ? "ADMIN"
      : event.actorUserId === trade.buyerId
        ? "BUYER"
        : event.actorUserId === trade.sellerId
          ? "SELLER"
          : "SYSTEM",
    data: (event.data as Record<string, unknown> | null) ?? null,
    createdAt: event.createdAt.toISOString(),
  };
}
