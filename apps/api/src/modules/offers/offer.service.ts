import {
  tierFor,
  type CreateOfferRequest,
  type MarketplaceOffer,
  type MarketplaceQuery,
  type MarketplaceResponse,
  type OfferBlockedReason,
  type OfferSide,
  type OfferView,
  type PaymentMethodKind,
  type UpdateOfferRequest,
} from "@abay/contracts";
import { Prisma, type Offer, type OfferPaymentMethod, type OfferStatus } from "@abay/database";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { AppError } from "@/common/errors/app-error";
import { fiatForAmount, formatEtb } from "@/common/money/fiat";
import { formatUsdt } from "@/common/money/units";
import { assertTransition, type TransitionTable } from "@/common/state-machine/transition";
import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { accounts } from "@/modules/ledger/account-code";
import { LedgerService } from "@/modules/ledger/ledger.service";
import { NotificationsService } from "@/modules/notifications/notifications.service";
import { fundingOf } from "@/modules/offers/offer-funding";
import { PaymentMethodService } from "@/modules/payment-methods/payment-method.service";
import { PresenceService, UNSEEN } from "@/modules/presence/presence.service";
import { OPEN } from "@/modules/trades/trade.machine";

/*
  Offers: what the marketplace lists.

  Posting one locks nothing. The escrow is taken from whoever gives up USDT
  when a trade opens (ADR-0004), so an offer is a promise its owner has to be
  able to keep at that moment - which is why the marketplace shows a SELL
  offer only while its owner can fund at least its minimum, and shows as
  "available" the lesser of what remains and what they hold. What a taker
  sees is what a taker could take.

  A trade snapshots everything it needs from the offer when it opens, so
  editing, pausing or closing an offer never reaches a trade already running.

  Because nothing is held, a seller may post more than they have, as on
  Binance, and their own view shows what the ad can offer right now - its
  "ad balance" - and why the market is not showing it when it is not. A sell
  ad the balance stops covering is also watched (checkFunding): its seller is
  told, and after OFFER_UNFUNDED_PAUSE_HOURS of it the ad goes offline.
*/

const SUBJECT = "offer";
const HOUR_MS = 3_600_000;
/** However often a balance at the edge dips, its owner hears "hidden" once a day at most. */
const TELL_AGAIN_AFTER_MS = 24 * HOUR_MS;

/**
 * The fourth transition table in the system. Exported for the AT-17 sweep in
 * offer.transitions.spec.ts: a table nobody can read from outside is a table
 * nobody can prove, and this one decides whether an offer can be taken.
 */
export const OFFER_TRANSITIONS: TransitionTable<OfferStatus> = {
  ACTIVE: ["PAUSED", "CLOSED"],
  PAUSED: ["ACTIVE", "CLOSED"],
  CLOSED: [],
};

const WITH_METHODS = {
  paymentMethods: {
    include: { paymentMethod: { select: { label: true } } },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.OfferInclude;

type OfferRow = Prisma.OfferGetPayload<{ include: typeof WITH_METHODS }>;

/** One rail an offer names: a kind, and on a SELL offer the seller's method. */
interface Rail {
  kind: PaymentMethodKind;
  paymentMethodId: string | null;
}

interface Shape {
  price: bigint;
  total: bigint;
  min: bigint;
  max: bigint;
}

/** What the marketplace query returns per offer, before it becomes a view. */
interface MarketRow {
  id: string;
  user_id: string;
  side: OfferSide;
  asset: string;
  fiat: string;
  price_santim: bigint;
  remaining_amount: bigint;
  min_santim: bigint;
  max_santim: bigint;
  payment_window_minutes: number;
  terms: string | null;
  require_verified: boolean;
  min_completed_trades: number;
  revision: number;
  username: string;
  kyc_status: string;
  available: bigint;
  available_santim: bigint;
  trades_total: number | null;
  trades_completed: number | null;
  trades_failed: number | null;
  release_total_ms: bigint | null;
  release_count: number | null;
  pay_total_ms: bigint | null;
  pay_count: number | null;
}

/** Who is looking at the market, as far as the rules an ad sets are concerned. */
interface Viewer {
  id: string;
  verified: boolean;
  completedTrades: number;
}

/** What the funding pass reads per live sell ad. */
interface FundingRow {
  id: string;
  user_id: string;
  remaining_amount: bigint;
  price_santim: bigint;
  min_santim: bigint;
  unfunded_since: Date | null;
  unfunded_notified_at: Date | null;
  available: bigint;
}

/** What one funding pass did: owners told an ad is hidden, ads taken offline, clocks stopped. */
export interface FundingPass {
  hidden: number;
  paused: number;
  cleared: number;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class OfferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentMethods: PaymentMethodService,
    private readonly ledger: LedgerService,
    private readonly presence: PresenceService,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OfferService.name);
  }

  /* ---------------------------------------------------------------- mine */

  async listMine(userId: string): Promise<OfferView[]> {
    const rows = await this.prisma.client.offer.findMany({
      where: { userId },
      include: WITH_METHODS,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const view = await this.viewer(
      userId,
      rows.map((row) => row.id),
    );
    return rows.map(view);
  }

  /**
   * How the owner sees their ads: each one's orders still running, and what
   * it can offer against their balance right now. One balance read however
   * many ads, since a seller's ads all draw on the same balance.
   */
  private async viewer(
    userId: string,
    offerIds: readonly string[],
  ): Promise<(row: OfferRow) => OfferView> {
    const [open, available] = await Promise.all([
      this.openOrders(offerIds),
      this.ledger.balance(accounts.userAvailable(userId)),
    ]);
    const pauseAfterMs = this.env.OFFER_UNFUNDED_PAUSE_HOURS * HOUR_MS;
    return (row) => toView(row, open.get(row.id) ?? 0, available, pauseAfterMs);
  }

  /**
   * Orders from these ads that are still running. The owner sees the number
   * before closing an ad, because closing it leaves them running - the escrow
   * and the terms of an order are its own from the moment it opens.
   */
  private async openOrders(offerIds: readonly string[]): Promise<Map<string, number>> {
    if (offerIds.length === 0) return new Map();
    const counts = await this.prisma.client.trade.groupBy({
      by: ["offerId"],
      where: { offerId: { in: [...offerIds] }, status: { in: [...OPEN] } },
      _count: { _all: true },
    });
    return new Map(counts.map((row) => [row.offerId, row._count._all]));
  }

  async getMine(userId: string, id: string): Promise<OfferView> {
    const row = await this.prisma.client.offer.findFirst({
      where: { id, userId },
      include: WITH_METHODS,
    });
    if (!row) throw AppError.notFound("There is no such offer.");
    return (await this.viewer(userId, [row.id]))(row);
  }

  /*
    Posting. Verification is what unlocks it (KYC_TIERS.canPostOffers): an
    offer asks strangers to trust its author, and the platform vouches for
    nobody it has not identified. Everything else is arithmetic and limits.
  */
  async create(userId: string, input: CreateOfferRequest): Promise<OfferView> {
    await this.assertMayPost(userId);

    const live = await this.prisma.client.offer.count({
      where: { userId, status: { in: ["ACTIVE", "PAUSED"] } },
    });
    if (live >= this.env.OFFER_MAX_PER_USER) {
      throw AppError.conflict(
        `You can have up to ${this.env.OFFER_MAX_PER_USER} offers. Close one first.`,
      );
    }

    const shape: Shape = {
      price: BigInt(input.priceSantim),
      total: BigInt(input.totalAmount),
      min: BigInt(input.minSantim),
      max: BigInt(input.maxSantim),
    };
    this.assertShape(shape);
    const rails = await this.resolveRails(userId, input.side, input);

    const row = await this.prisma.client.offer.create({
      data: {
        userId,
        side: input.side,
        asset: "USDT",
        priceSantim: shape.price,
        totalAmount: shape.total,
        remainingAmount: shape.total,
        minSantim: shape.min,
        maxSantim: shape.max,
        paymentWindowMinutes: input.paymentWindowMinutes,
        terms: blankAsNull(input.terms),
        autoReply: blankAsNull(input.autoReply),
        requireVerified: input.requireVerified ?? false,
        minCompletedTrades: input.minCompletedTrades ?? 0,
        paymentMethods: { create: rails },
      },
      include: WITH_METHODS,
    });

    this.logger.info(
      { event: "offer.posted", userId, offerId: row.id, side: row.side },
      "offer posted",
    );
    return (await this.viewer(userId, [row.id]))(row);
  }

  /*
    Editing, under the row lock: a trade opening at the same moment takes
    from `remaining` through the same lock, so the arithmetic below cannot
    overwrite it. What open trades have already taken is kept.
  */
  async update(userId: string, id: string, patch: UpdateOfferRequest): Promise<OfferView> {
    const row = await this.prisma.transaction("offer:update", async (tx) => {
      const current = await this.lock(tx, userId, id);
      if (current.status === "CLOSED") throw AppError.conflict("This offer is closed.");

      const shape: Shape = {
        price: patch.priceSantim !== undefined ? BigInt(patch.priceSantim) : current.priceSantim,
        total: patch.totalAmount !== undefined ? BigInt(patch.totalAmount) : current.totalAmount,
        min: patch.minSantim !== undefined ? BigInt(patch.minSantim) : current.minSantim,
        max: patch.maxSantim !== undefined ? BigInt(patch.maxSantim) : current.maxSantim,
      };
      this.assertShape(shape);

      const taken = current.totalAmount - current.remainingAmount;
      const remaining = shape.total - taken;
      if (remaining < 0n) {
        throw AppError.validation([
          {
            path: "totalAmount",
            message: `Trades already open have taken ${formatUsdt(taken)} USDT of this offer. The total cannot go below that.`,
          },
        ]);
      }

      const railsGiven =
        current.side === "SELL"
          ? patch.paymentMethodIds !== undefined
          : patch.paymentKinds !== undefined;
      const rails = railsGiven ? await this.resolveRails(userId, current.side, patch, tx) : null;

      /*
        The version moves when the deal moves. Everything a taker reads before
        they commit counts - the price, the limits, the rails, how long they
        have to pay, the terms, who may take it - because an order carries the
        version it was placed against and is refused if it has moved. What only
        the advertiser sees does not count: the total behind the ad, whose
        remainder is checked at order time anyway, and the auto-reply, which
        nobody reads until the order exists.
      */
      const terms = patch.terms !== undefined ? blankAsNull(patch.terms) : current.terms;
      const dealChanged =
        shape.price !== current.priceSantim ||
        shape.min !== current.minSantim ||
        shape.max !== current.maxSantim ||
        terms !== current.terms ||
        (patch.paymentWindowMinutes !== undefined &&
          patch.paymentWindowMinutes !== current.paymentWindowMinutes) ||
        (patch.requireVerified !== undefined &&
          patch.requireVerified !== current.requireVerified) ||
        (patch.minCompletedTrades !== undefined &&
          patch.minCompletedTrades !== current.minCompletedTrades) ||
        (rails !== null && (await kindsOf(tx, id)) !== kindsIn(rails));

      await tx.offer.update({
        where: { id },
        data: {
          priceSantim: shape.price,
          totalAmount: shape.total,
          remainingAmount: remaining,
          minSantim: shape.min,
          maxSantim: shape.max,
          ...(patch.paymentWindowMinutes !== undefined
            ? { paymentWindowMinutes: patch.paymentWindowMinutes }
            : {}),
          ...(patch.terms !== undefined ? { terms: blankAsNull(patch.terms) } : {}),
          ...(patch.autoReply !== undefined ? { autoReply: blankAsNull(patch.autoReply) } : {}),
          ...(patch.requireVerified !== undefined
            ? { requireVerified: patch.requireVerified }
            : {}),
          ...(patch.minCompletedTrades !== undefined
            ? { minCompletedTrades: patch.minCompletedTrades }
            : {}),
          ...(rails ? { paymentMethods: { deleteMany: {}, create: rails } } : {}),
          ...(dealChanged ? { revision: { increment: 1 } } : {}),
        },
      });
      return tx.offer.findUniqueOrThrow({ where: { id }, include: WITH_METHODS });
    });
    return (await this.viewer(userId, [row.id]))(row);
  }

  /**
   * Pause, resume or close. Closed is for good; anything else can come back.
   * Any change stops the funding clock: an ad that is off is not waiting to
   * go offline, and one switched back on gets a full day again before it does.
   */
  async setStatus(userId: string, id: string, to: OfferStatus): Promise<OfferView> {
    const row = await this.prisma.transaction("offer:status", async (tx) => {
      const current = await this.lock(tx, userId, id);
      assertTransition(SUBJECT, OFFER_TRANSITIONS, current.status, to);
      return tx.offer.update({
        where: { id },
        data: { status: to, unfundedSince: null },
        include: WITH_METHODS,
      });
    });
    this.logger.info({ event: "offer.status", userId, offerId: id, status: to }, "offer status");
    return (await this.viewer(userId, [row.id]))(row);
  }

  /* --------------------------------------------------------- marketplace */

  /**
   * What a taker can choose from. Best price first - lowest when the viewer
   * is buying, highest when selling - and only offers that could be taken
   * this minute: live, by a live account, and fundable to at least their own
   * minimum. The cursor is the last row's price and id, so a page boundary
   * cannot skip or repeat an offer as prices change.
   */
  async marketplace(viewerId: string, query: MarketplaceQuery): Promise<MarketplaceResponse> {
    const side: OfferSide = query.want === "BUY" ? "SELL" : "BUY";
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const viewer = await this.taker(viewerId);
    const rows = await this.search(side, {
      limit: query.limit + 1,
      amountSantim: query.amountSantim ? BigInt(query.amountSantim) : null,
      paymentKind: query.paymentKind ?? null,
      minPaymentWindow: query.minPaymentWindowMinutes ?? null,
      takeableBy: query.takeable ? viewer : null,
      cursor,
      id: null,
    });
    const page = rows.slice(0, query.limit);
    const offers = await this.toMarketplace(page, viewer);
    const last = page[page.length - 1];
    return {
      offers,
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  /** One offer, as a taker about to accept it sees it. Gone from the list means gone from here. */
  async getForTaking(viewerId: string, id: string): Promise<MarketplaceOffer> {
    const rows = await this.search(null, {
      limit: 1,
      amountSantim: null,
      paymentKind: null,
      minPaymentWindow: null,
      takeableBy: null,
      cursor: null,
      id,
    });
    const [offer] = await this.toMarketplace(rows, await this.taker(viewerId));
    if (!offer) throw AppError.notFound("That offer is not available right now.");
    return offer;
  }

  /** The two things an ad may ask of whoever takes it, read for the viewer once per request. */
  private async taker(id: string): Promise<Viewer> {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id },
      select: { kycStatus: true, traderStats: { select: { tradesCompleted: true } } },
    });
    return {
      id,
      verified: user.kycStatus === "APPROVED",
      completedTrades: user.traderStats?.tradesCompleted ?? 0,
    };
  }

  private async search(
    side: OfferSide | null,
    options: {
      limit: number;
      amountSantim: bigint | null;
      paymentKind: PaymentMethodKind | null;
      minPaymentWindow: number | null;
      takeableBy: Viewer | null;
      cursor: { price: bigint; id: string } | null;
      id: string | null;
    },
  ): Promise<MarketRow[]> {
    const ascending = side === "SELL";
    const direction = Prisma.raw(ascending ? "ASC" : "DESC");
    const sideFilter = side ? Prisma.sql`AND o.side = ${side}::offer_side` : Prisma.empty;
    const idFilter = options.id ? Prisma.sql`AND o.id = ${options.id}` : Prisma.empty;
    const amountFilter =
      options.amountSantim !== null
        ? Prisma.sql`AND ${options.amountSantim}::bigint BETWEEN p.min_santim AND LEAST(p.max_santim, p.available_santim)`
        : Prisma.empty;
    const kindFilter = options.paymentKind
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM offer_payment_methods pm WHERE pm.offer_id = p.id AND pm.kind = ${options.paymentKind}::payment_method_kind)`
      : Prisma.empty;
    const windowFilter =
      options.minPaymentWindow !== null
        ? Prisma.sql`AND p.payment_window_minutes >= ${options.minPaymentWindow}::int`
        : Prisma.empty;
    // The trade engine's own rules (TradeService.create), so nothing listed here is refused there.
    const takeableFilter = options.takeableBy
      ? Prisma.sql`AND p.user_id <> ${options.takeableBy.id} AND (NOT p.require_verified OR ${options.takeableBy.verified}) AND p.min_completed_trades <= ${options.takeableBy.completedTrades}::int`
      : Prisma.empty;
    const cursorFilter = options.cursor
      ? ascending
        ? Prisma.sql`AND (p.price_santim > ${options.cursor.price}::bigint OR (p.price_santim = ${options.cursor.price}::bigint AND p.id > ${options.cursor.id}))`
        : Prisma.sql`AND (p.price_santim < ${options.cursor.price}::bigint OR (p.price_santim = ${options.cursor.price}::bigint AND p.id < ${options.cursor.id}))`
      : Prisma.empty;

    /*
      "available" is what could be taken: for a SELL offer the lesser of what
      remains and the seller's spendable balance, read from the same ledger
      row a trade would lock. Rounded to santim half up, exactly as
      fiatForAmount does, so the list and the trade agree about the limits.
    */
    return this.prisma.client.$queryRaw<MarketRow[]>`
      WITH candidates AS (
        SELECT o.id, o.user_id, o.side::text AS side, o.asset::text AS asset, o.fiat,
               o.price_santim, o.remaining_amount, o.min_santim, o.max_santim,
               o.payment_window_minutes, o.terms, o.require_verified, o.min_completed_trades,
               o.revision,
               u.username, u.kyc_status::text AS kyc_status,
               CASE WHEN o.side = 'SELL'
                    THEN LEAST(o.remaining_amount, COALESCE(b.balance, 0))
                    ELSE o.remaining_amount END AS available,
               s.trades_total, s.trades_completed, s.trades_failed,
               s.release_total_ms, s.release_count, s.pay_total_ms, s.pay_count
          FROM offers o
          JOIN users u ON u.id = o.user_id
          LEFT JOIN ledger_accounts a ON a.code = 'LIAB:USER:' || o.user_id || ':USDT:AVAILABLE'
          LEFT JOIN ledger_account_balances b ON b.account_id = a.id
          LEFT JOIN trader_stats s ON s.user_id = o.user_id
         WHERE o.status = 'ACTIVE' AND u.status = 'ACTIVE' ${sideFilter} ${idFilter}
      ), priced AS (
        SELECT c.*,
               floor((c.available::numeric * c.price_santim + 500000) / 1000000)::bigint AS available_santim
          FROM candidates c
      )
      SELECT * FROM priced p
       WHERE p.available_santim >= p.min_santim ${amountFilter} ${kindFilter} ${windowFilter} ${takeableFilter} ${cursorFilter}
       ORDER BY p.price_santim ${direction}, p.id ${direction}
       LIMIT ${options.limit}`;
  }

  private async toMarketplace(rows: MarketRow[], viewer: Viewer): Promise<MarketplaceOffer[]> {
    if (rows.length === 0) return [];
    const [rails, presence] = await Promise.all([
      this.prisma.client.offerPaymentMethod.findMany({
        where: { offerId: { in: rows.map((row) => row.id) } },
        select: { offerId: true, kind: true },
      }),
      this.presence.of(rows.map((row) => row.user_id)),
    ]);
    const kindsByOffer = new Map<string, Set<PaymentMethodKind>>();
    for (const rail of rails) {
      const set = kindsByOffer.get(rail.offerId) ?? new Set<PaymentMethodKind>();
      set.add(rail.kind);
      kindsByOffer.set(rail.offerId, set);
    }
    return rows.map((row) => {
      const effectiveMax =
        row.max_santim < row.available_santim ? row.max_santim : row.available_santim;
      const total = row.trades_total ?? 0;
      const completed = row.trades_completed ?? 0;
      // Over finished trades only: one still running is not a failure yet.
      const finished = completed + (row.trades_failed ?? 0);
      return {
        id: row.id,
        side: row.side,
        asset: row.asset,
        fiat: row.fiat,
        priceSantim: row.price_santim.toString(),
        available: row.available.toString(),
        minSantim: row.min_santim.toString(),
        maxSantim: effectiveMax.toString(),
        paymentWindowMinutes:
          row.payment_window_minutes as MarketplaceOffer["paymentWindowMinutes"],
        paymentKinds: [...(kindsByOffer.get(row.id) ?? [])].sort(),
        terms: row.terms,
        requireVerified: row.require_verified,
        minCompletedTrades: row.min_completed_trades,
        revision: row.revision,
        advertiser: {
          userId: row.user_id,
          username: row.username,
          verified: row.kyc_status === "APPROVED",
          ...(presence.get(row.user_id) ?? UNSEEN),
          tradesTotal: total,
          tradesCompleted: completed,
          completionRate: finished > 0 ? Math.round((completed / finished) * 100) : null,
          avgReleaseSeconds: average(row.release_total_ms, row.release_count),
          avgPaySeconds: average(row.pay_total_ms, row.pay_count),
        },
        isMine: row.user_id === viewer.id,
        blockedBecause: blockedFor(row, viewer),
      };
    });
  }

  /* ------------------------------------------------ for the trade engine */

  /**
   * Takes `amount` off what remains, if the offer is live and has it. One
   * statement, so two takers racing for the last of an offer cannot both
   * get it. Null means it could not be taken - closed, paused, or not enough
   * left - and the caller decides what to tell the taker.
   */
  async reserve(tx: Tx, id: string, amount: bigint): Promise<Offer | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE offers
         SET remaining_amount = remaining_amount - ${amount}::bigint, "updatedAt" = now()
       WHERE id = ${id} AND status = 'ACTIVE' AND remaining_amount >= ${amount}::bigint
       RETURNING id`;
    if (!rows[0]) return null;
    return tx.offer.findUniqueOrThrow({ where: { id } });
  }

  /** Gives `amount` back after a trade that did not go through. */
  async restore(tx: Tx, id: string, amount: bigint): Promise<void> {
    await tx.$executeRaw`
      UPDATE offers
         SET remaining_amount = LEAST(total_amount, remaining_amount + ${amount}::bigint), "updatedAt" = now()
       WHERE id = ${id}`;
  }

  /* ---------------------------------------------- the worker's funding pass */

  /**
   * One pass over live sell ads against their sellers' balances, for
   * OfferFundingWatcher. The market already leaves out an ad the balance
   * cannot cover (search()), so nothing here decides what a taker sees - it
   * decides what the seller is told, and when an ad stops being on:
   *
   * - an ad the balance has stopped covering starts its clock, and its owner
   *   is told, at most once a day however often a balance at the edge dips;
   * - an ad covered again, switched off, or no longer anybody's live ad has
   *   its clock stopped;
   * - an ad still uncovered when its clock reaches OFFER_UNFUNDED_PAUSE_HOURS
   *   goes offline, ACTIVE to PAUSED, and its owner is told that too.
   *
   * Every write is conditional on what the pass read, so an owner switching
   * the ad off in between, or a second worker, is never overwritten. One
   * transaction, so an ad's clock and the notification about it commit
   * together or not at all. `offerIds` narrows the pass, for tests; the
   * worker passes nothing.
   */
  async checkFunding(
    options: { offerIds?: readonly string[]; now?: Date } = {},
  ): Promise<FundingPass> {
    const scope = options.offerIds;
    if (scope?.length === 0) return { hidden: 0, paused: 0, cleared: 0 };
    const now = options.now ?? new Date();
    const hours = this.env.OFFER_UNFUNDED_PAUSE_HOURS;

    return this.prisma.transaction("offers:funding", async (tx) => {
      const rows = await tx.$queryRaw<FundingRow[]>`
        SELECT o.id, o.user_id, o.remaining_amount, o.price_santim, o.min_santim,
               o.unfunded_since, o.unfunded_notified_at,
               COALESCE(b.balance, 0)::bigint AS available
          FROM offers o
          JOIN users u ON u.id = o.user_id
          LEFT JOIN ledger_accounts a ON a.code = 'LIAB:USER:' || o.user_id || ':USDT:AVAILABLE'
          LEFT JOIN ledger_account_balances b ON b.account_id = a.id
         WHERE o.status = 'ACTIVE' AND o.side = 'SELL' AND u.status = 'ACTIVE'
               ${scope ? Prisma.sql`AND o.id IN (${Prisma.join(scope)})` : Prisma.empty}`;
      const uncovered = rows.filter(
        (row) =>
          fundingOf(
            {
              side: "SELL",
              remaining: row.remaining_amount,
              price: row.price_santim,
              min: row.min_santim,
            },
            row.available,
          ).hiddenBecause === "BALANCE",
      );
      const uncoveredIds = uncovered.map((row) => row.id);

      const cleared = await tx.offer.updateMany({
        where: {
          unfundedSince: { not: null },
          id: scope ? { in: [...scope], notIn: uncoveredIds } : { notIn: uncoveredIds },
        },
        data: { unfundedSince: null },
      });

      let hidden = 0;
      let paused = 0;
      for (const row of uncovered) {
        const since = row.unfunded_since;
        const what = `Your sell ad at ${formatEtb(row.price_santim)} birr`;
        const smallest = `${formatEtb(row.min_santim)} birr`;

        if (since && now.getTime() - since.getTime() >= hours * HOUR_MS) {
          assertTransition(SUBJECT, OFFER_TRANSITIONS, "ACTIVE", "PAUSED");
          const off = await tx.offer.updateMany({
            where: { id: row.id, status: "ACTIVE", unfundedSince: since },
            data: { status: "PAUSED", unfundedSince: null },
          });
          if (off.count !== 1) continue;
          paused += 1;
          this.logger.info(
            { event: "offer.paused_unfunded", userId: row.user_id, offerId: row.id },
            "ad taken offline: the balance did not cover it",
          );
          await this.notifications.notify(
            {
              userId: row.user_id,
              type: "OFFER_PAUSED",
              title: "Your ad went offline",
              body: `${what} was taken offline: for ${plural(hours, "hour")} your available balance could not cover its smallest order of ${smallest}. Add USDT, then switch it back on in My ads.`,
              link: "/trade/ads?tab=offline",
            },
            tx,
          );
          continue;
        }
        // Clock already running: its owner has been told.
        if (since) continue;

        const toldRecently =
          row.unfunded_notified_at !== null &&
          now.getTime() - row.unfunded_notified_at.getTime() < TELL_AGAIN_AFTER_MS;
        const started = await tx.offer.updateMany({
          where: { id: row.id, status: "ACTIVE", unfundedSince: null },
          data: { unfundedSince: now, ...(toldRecently ? {} : { unfundedNotifiedAt: now }) },
        });
        if (started.count !== 1 || toldRecently) continue;
        hidden += 1;
        await this.notifications.notify(
          {
            userId: row.user_id,
            type: "OFFER_HIDDEN",
            title: "Your ad is hidden from the market",
            body: `${what} is hidden: your available balance of ${formatUsdt(row.available)} USDT is worth less than its smallest order of ${smallest}. Add USDT within ${plural(hours, "hour")} or the ad goes offline.`,
            link: "/trade/ads",
          },
          tx,
        );
      }
      return { hidden, paused, cleared: cleared.count };
    });
  }

  /* ------------------------------------------------------------- plumbing */

  private async assertMayPost(userId: string): Promise<void> {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { status: true, kycStatus: true },
    });
    if (user.status !== "ACTIVE") {
      throw AppError.forbidden("Your account cannot post offers right now.");
    }
    if (!tierFor(user.kycStatus).canPostOffers) {
      throw AppError.forbidden("Verify your identity to post an offer.");
    }
  }

  /** The arithmetic every offer has to satisfy, whether new or edited. */
  private assertShape(shape: Shape): void {
    if (shape.total < this.env.TRADE_MIN_AMOUNT_MICRO) {
      throw AppError.validation([
        {
          path: "totalAmount",
          message: `Offer at least ${formatUsdt(this.env.TRADE_MIN_AMOUNT_MICRO)} USDT.`,
        },
      ]);
    }
    if (shape.min > shape.max) {
      throw AppError.validation([
        { path: "maxSantim", message: "The maximum must be at least the minimum." },
      ]);
    }
    const worth = fiatForAmount(shape.total, shape.price);
    if (shape.min > worth) {
      throw AppError.validation([
        {
          path: "minSantim",
          message: `The whole offer is worth ${formatEtb(worth)} birr, which is less than your minimum.`,
        },
      ]);
    }
  }

  /**
   * The rails an offer names, checked. On a SELL offer every id must be one
   * of the seller's own live methods; on a BUY offer the kinds are simply
   * de-duplicated. The two lists are never mixed.
   */
  private async resolveRails(
    userId: string,
    side: OfferSide,
    input: {
      paymentMethodIds?: string[] | undefined;
      paymentKinds?: PaymentMethodKind[] | undefined;
    },
    tx?: Tx,
  ): Promise<Rail[]> {
    if (side === "SELL") {
      const ids = [...new Set(input.paymentMethodIds ?? [])];
      const methods = await this.paymentMethods.ownedActive(userId, ids, tx);
      if (ids.length === 0 || methods.length !== ids.length) {
        throw AppError.validation([
          {
            path: "paymentMethodIds",
            message: "Choose payment methods of your own that are still active.",
          },
        ]);
      }
      return ids.map((id) => {
        const method = methods.find((candidate) => candidate.id === id);
        if (!method) throw AppError.notFound("There is no such payment method.");
        return { kind: method.kind, paymentMethodId: id };
      });
    }
    const kinds = [...new Set(input.paymentKinds ?? [])];
    if (kinds.length === 0) {
      throw AppError.validation([
        { path: "paymentKinds", message: "Choose at least one way you will pay." },
      ]);
    }
    return kinds.map((kind) => ({ kind, paymentMethodId: null }));
  }

  /** The owner's offer, locked for the rest of the transaction. Anyone else's is not found. */
  private async lock(tx: Tx, userId: string, id: string): Promise<Offer> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM offers WHERE id = ${id} AND user_id = ${userId} FOR UPDATE`;
    if (!rows[0]) throw AppError.notFound("There is no such offer.");
    return tx.offer.findUniqueOrThrow({ where: { id } });
  }
}

/* --------------------------------------------------------------- helpers */

const blankAsNull = (value: string | undefined): string | null =>
  value !== undefined && value.length > 0 ? value : null;

/** Why this viewer could not take this ad: the same two rules TradeService.create enforces. */
function blockedFor(
  row: Pick<MarketRow, "require_verified" | "min_completed_trades">,
  viewer: Viewer,
): OfferBlockedReason | null {
  if (row.require_verified && !viewer.verified) return "VERIFICATION";
  if (row.min_completed_trades > viewer.completedTrades) return "COMPLETED_TRADES";
  return null;
}

const plural = (count: number, unit: string): string =>
  `${count.toString()} ${unit}${count === 1 ? "" : "s"}`;

const average = (totalMs: bigint | null, count: number | null): number | null =>
  count && count > 0 && totalMs !== null ? Math.round(Number(totalMs) / count / 1_000) : null;

const encodeCursor = (row: MarketRow): string =>
  Buffer.from(`${row.price_santim.toString()}:${row.id}`).toString("base64url");

function decodeCursor(cursor: string): { price: bigint; id: string } {
  const decoded = Buffer.from(cursor, "base64url").toString();
  const match = /^(\d{1,20}):([0-9a-f-]{36})$/.exec(decoded);
  if (!match?.[1] || !match[2]) {
    throw AppError.validation([{ path: "cursor", message: "That page cursor is not valid." }]);
  }
  return { price: BigInt(match[1]), id: match[2] };
}

/*
  The kinds an ad can be paid through, as one comparable string. A taker reads
  the kinds, never which of the advertiser's accounts is behind one, so swapping
  the account behind a kind is not a change to the deal.
*/
const kindsIn = (rails: readonly { kind: string }[]): string =>
  [...new Set(rails.map((rail) => rail.kind))].sort().join(",");

async function kindsOf(tx: Tx, offerId: string): Promise<string> {
  return kindsIn(
    await tx.offerPaymentMethod.findMany({ where: { offerId }, select: { kind: true } }),
  );
}

function toView(
  row:
    | OfferRow
    | (Offer & {
        paymentMethods: (OfferPaymentMethod & { paymentMethod: { label: string } | null })[];
      }),
  openOrders: number,
  available: bigint,
  pauseAfterMs: number,
): OfferView {
  const funding =
    row.status === "CLOSED"
      ? null
      : fundingOf(
          {
            side: row.side,
            remaining: row.remainingAmount,
            price: row.priceSantim,
            min: row.minSantim,
          },
          available,
        );
  // The worker's clock, shown only while what it measures is still true.
  const since =
    row.status === "ACTIVE" && funding?.hiddenBecause === "BALANCE" ? row.unfundedSince : null;
  return {
    id: row.id,
    side: row.side,
    asset: row.asset,
    fiat: row.fiat,
    priceSantim: row.priceSantim.toString(),
    totalAmount: row.totalAmount.toString(),
    remainingAmount: row.remainingAmount.toString(),
    minSantim: row.minSantim.toString(),
    maxSantim: row.maxSantim.toString(),
    paymentWindowMinutes: row.paymentWindowMinutes as OfferView["paymentWindowMinutes"],
    paymentMethods: row.paymentMethods.map((rail) => ({
      kind: rail.kind,
      paymentMethodId: rail.paymentMethodId,
      label: rail.paymentMethod?.label ?? null,
    })),
    terms: row.terms,
    autoReply: row.autoReply,
    requireVerified: row.requireVerified,
    minCompletedTrades: row.minCompletedTrades,
    status: row.status,
    revision: row.revision,
    openOrders,
    adBalance: (funding?.adBalance ?? 0n).toString(),
    hiddenBecause: funding?.hiddenBecause ?? null,
    unfundedSince: since?.toISOString() ?? null,
    pausesAt: since ? new Date(since.getTime() + pauseAfterMs).toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
