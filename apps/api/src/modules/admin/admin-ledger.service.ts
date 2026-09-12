import {
  ledgerAccountType,
  type LedgerAccountDetail,
  type LedgerAccountsFilter,
  type LedgerAccountsResponse,
  type LedgerAccountSummary,
  type LedgerOverview,
  type LedgerStatementFilter,
  type LedgerStatementRow,
  type LedgerTransactionDetail,
  type LedgerTransactionsFilter,
  type LedgerTransactionsResponse,
  type LedgerTransactionView,
} from "@abay/contracts";
import { Prisma, type LedgerAccount, type LedgerAccountBalance } from "@abay/database";
import { Injectable } from "@nestjs/common";

import { AppError } from "@/common/errors/app-error";
import { PrismaService } from "@/infra/prisma/prisma.service";
import { type AdminSessionContext } from "@/modules/admin/admin-session.service";
import { AuditService } from "@/modules/audit/audit.service";

/*
  The ledger, read by an administrator.

  Read is all this does. It has no way to post, no dependency on the service
  that can, and every query in it is a SELECT: the one place in the platform
  that moves money stays the one place. What it offers is the view an
  operator needs of a double-entry ledger - is it consistent right now, what
  does it hold, what happened to this account, what did this transaction do -
  in the ledger's own terms, with amounts as strings of millionths and
  balances in each account's natural sense.

  Looking at a specific person's rows is CONFIDENTIAL (data-classification.md),
  so opening a customer's or a trade's account, or a transaction that touched
  one, is recorded in the audit log, the way opening an identity submission
  is. The aggregates on the overview are INTERNAL and are not.
*/

type AccountRow = LedgerAccount & { balance: LedgerAccountBalance | null };

interface ViewContext {
  correlationId: string;
  ip?: string | undefined;
}

@Injectable()
export class AdminLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* -------------------------------------------------------------- overview */

  async overview(): Promise<LedgerOverview> {
    const db = this.prisma.client;
    const [health, trial, platform, customers, trades, accounts, transactions, entries, last] =
      await Promise.all([
        db.$queryRaw<{ unbalanced: number; drift: number; breaches: number }[]>`
          SELECT
            (SELECT count(*)::int FROM (
               SELECT transaction_id FROM ledger_entries
                GROUP BY transaction_id, asset
               HAVING sum(signed_amount) <> 0 OR count(*) < 2) u) AS unbalanced,
            (SELECT count(*)::int
               FROM ledger_account_balances b
               LEFT JOIN (
                 SELECT e.account_id,
                        sum(CASE WHEN a.type IN ('ASSET', 'EXPENSE')
                                 THEN e.signed_amount ELSE -e.signed_amount END) AS bal,
                        count(*)::int AS n
                   FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
                  GROUP BY e.account_id) r ON r.account_id = b.account_id
              WHERE b.balance <> coalesce(r.bal, 0) OR b.entry_count <> coalesce(r.n, 0)) AS drift,
            (SELECT count(*)::int FROM ledger_account_balances
              WHERE balance < 0 AND NOT allows_negative) AS breaches`,
        db.$queryRaw<{ type: string; accounts: number; balance: string }[]>`
          SELECT a.type::text AS type, count(*)::int AS accounts,
                 coalesce(sum(b.balance), 0)::text AS balance
            FROM ledger_accounts a JOIN ledger_account_balances b ON b.account_id = a.id
           GROUP BY a.type`,
        db.ledgerAccount.findMany({
          where: { scope: "PLATFORM" },
          include: { balance: true },
          orderBy: { code: "asc" },
        }),
        db.$queryRaw<{ count: number; available: string; pending: string }[]>`
          SELECT count(DISTINCT a.owner_id)::int AS count,
                 coalesce(sum(b.balance) FILTER (WHERE a.purpose = 'AVAILABLE'), 0)::text AS available,
                 coalesce(sum(b.balance) FILTER (WHERE a.purpose = 'PENDING_WITHDRAWAL'), 0)::text AS pending
            FROM ledger_accounts a JOIN ledger_account_balances b ON b.account_id = a.id
           WHERE a.scope = 'USER'`,
        db.$queryRaw<{ open: number; escrowed: string }[]>`
          SELECT count(*)::int AS open, coalesce(sum(b.balance), 0)::text AS escrowed
            FROM ledger_accounts a JOIN ledger_account_balances b ON b.account_id = a.id
           WHERE a.scope = 'TRADE' AND b.balance > 0`,
        db.ledgerAccount.count(),
        db.ledgerTransaction.count(),
        db.ledgerEntry.count(),
        db.ledgerTransaction.findFirst({
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);

    const h = health[0] ?? { unbalanced: 0, drift: 0, breaches: 0 };
    const byType = new Map(trial.map((row) => [row.type, row]));
    const trialBalance = ledgerAccountType.options.map((type) => ({
      type,
      accounts: byType.get(type)?.accounts ?? 0,
      balance: byType.get(type)?.balance ?? "0",
    }));
    const side = (types: readonly string[]) =>
      trialBalance
        .filter((row) => types.includes(row.type))
        .reduce((sum, row) => sum + BigInt(row.balance), 0n);
    const debitSide = side(["ASSET", "EXPENSE"]);
    const creditSide = side(["LIABILITY", "EQUITY", "REVENUE"]);
    const c = customers[0] ?? { count: 0, available: "0", pending: "0" };
    const t = trades[0] ?? { open: 0, escrowed: "0" };

    return {
      checkedAt: new Date().toISOString(),
      health: {
        balanced: h.unbalanced === 0,
        unbalancedTransactions: h.unbalanced,
        projectionDrift: h.drift,
        floorBreaches: h.breaches,
      },
      totals: {
        accounts,
        transactions,
        entries,
        lastPostedAt: last?.createdAt.toISOString() ?? null,
      },
      trialBalance,
      equation: {
        debitSide: debitSide.toString(),
        creditSide: creditSide.toString(),
        holds: debitSide === creditSide,
      },
      platform: platform.map(toSummary),
      customers: { count: c.count, available: c.available, pendingWithdrawal: c.pending },
      trades: { open: t.open, escrowed: t.escrowed },
    };
  }

  /* -------------------------------------------------------------- accounts */

  async accounts(filter: LedgerAccountsFilter): Promise<LedgerAccountsResponse> {
    const conditions: Prisma.LedgerAccountWhereInput[] = [];
    if (filter.scope) conditions.push({ scope: filter.scope });
    if (filter.type) conditions.push({ type: filter.type });
    if (filter.ownerId) conditions.push({ ownerId: filter.ownerId });
    if (filter.q) conditions.push({ code: { contains: filter.q, mode: "insensitive" } });
    if (filter.cursor) conditions.push({ code: { gt: filter.cursor } });

    const rows = await this.prisma.client.ledgerAccount.findMany({
      where: { AND: conditions },
      include: { balance: true },
      orderBy: { code: "asc" },
      take: filter.limit + 1,
    });
    const page = rows.slice(0, filter.limit);
    return {
      accounts: page.map(toSummary),
      nextCursor: rows.length > filter.limit ? (page.at(-1)?.code ?? null) : null,
    };
  }

  /** One account and the first page of its statement. Recorded when it is somebody's. */
  async account(
    id: string,
    session: AdminSessionContext,
    context: ViewContext,
  ): Promise<LedgerAccountDetail> {
    const row = await this.prisma.client.ledgerAccount.findUnique({
      where: { id },
      include: { balance: true },
    });
    if (!row) throw AppError.notFound("There is no such account.");

    if (row.scope !== "PLATFORM") {
      await this.audit.record({
        action: "ledger.account_viewed",
        actor: { id: session.admin.id, email: session.admin.email },
        subject: { type: "ledger_account", id: row.id },
        after: { code: row.code, scope: row.scope, ownerId: row.ownerId },
        correlationId: context.correlationId,
        ip: context.ip ?? null,
      });
    }

    const statement = await this.statement(row.id, { limit: 50 });
    return { account: toSummary(row), ...statement };
  }

  /*
    The statement: every entry against the account, newest first, each with
    the balance it left behind. The running balance is a window over the
    entries in id order - ids are UUIDv7, minted at insert, and the row lock
    in LedgerService serialises inserts against one account, so for one
    account that order is the order the balance actually moved in.
  */
  async statement(
    accountId: string,
    filter: LedgerStatementFilter,
  ): Promise<{ statement: LedgerStatementRow[]; nextCursor: string | null }> {
    const before = filter.before ? Prisma.sql`AND id < ${filter.before}` : Prisma.empty;
    const rows = await this.prisma.client.$queryRaw<StatementRow[]>`
      WITH lines AS (
        SELECT e.id, e.transaction_id, e.direction::text AS direction, e.amount::text AS amount,
               CASE WHEN a.type IN ('ASSET', 'EXPENSE')
                    THEN e.signed_amount ELSE -e.signed_amount END AS delta,
               t."createdAt" AS created_at, t.reason::text AS reason,
               t.reference_type, t.reference_id
          FROM ledger_entries e
          JOIN ledger_accounts a ON a.id = e.account_id
          JOIN ledger_transactions t ON t.id = e.transaction_id
         WHERE e.account_id = ${accountId}
      ), running AS (
        SELECT *, (sum(delta) OVER (ORDER BY id ROWS UNBOUNDED PRECEDING))::text AS balance_after
          FROM lines
      )
      SELECT id, transaction_id, direction, amount, created_at, reason,
             reference_type, reference_id, balance_after
        FROM running
       WHERE TRUE ${before}
       ORDER BY id DESC
       LIMIT ${filter.limit + 1}`;
    const page = rows.slice(0, filter.limit);
    return {
      statement: page.map((row) => ({
        entryId: row.id,
        transactionId: row.transaction_id,
        createdAt: row.created_at.toISOString(),
        reason: row.reason as LedgerStatementRow["reason"],
        referenceType: row.reference_type,
        referenceId: row.reference_id,
        direction: row.direction as LedgerStatementRow["direction"],
        amount: row.amount,
        balanceAfter: row.balance_after,
      })),
      nextCursor: rows.length > filter.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /* ---------------------------------------------------------- transactions */

  async transactions(filter: LedgerTransactionsFilter): Promise<LedgerTransactionsResponse> {
    const where: Prisma.LedgerTransactionWhereInput = {
      ...(filter.reason ? { reason: filter.reason } : {}),
      ...(filter.referenceType ? { referenceType: filter.referenceType } : {}),
      ...(filter.referenceId ? { referenceId: filter.referenceId } : {}),
      ...(filter.correlationId ? { correlationId: filter.correlationId } : {}),
      ...(filter.accountId ? { entries: { some: { accountId: filter.accountId } } } : {}),
      ...(filter.cursor ? { id: { lt: filter.cursor } } : {}),
    };
    const rows = await this.prisma.client.ledgerTransaction.findMany({
      where,
      include: TRANSACTION_INCLUDE,
      // UUIDv7 ids are time-ordered, so one unique column is both the sort and the cursor.
      orderBy: { id: "desc" },
      take: filter.limit + 1,
    });
    const page = rows.slice(0, filter.limit);
    return {
      transactions: page.map(toView),
      nextCursor: rows.length > filter.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** One transaction in full. Recorded when any of its entries is somebody's. */
  async transaction(
    id: string,
    session: AdminSessionContext,
    context: ViewContext,
  ): Promise<LedgerTransactionDetail> {
    const row = await this.prisma.client.ledgerTransaction.findUnique({
      where: { id },
      include: {
        ...TRANSACTION_INCLUDE,
        reverses: { select: { id: true, reason: true, createdAt: true } },
        reversedBy: { select: { id: true, reason: true, createdAt: true }, orderBy: { id: "asc" } },
      },
    });
    if (!row) throw AppError.notFound("There is no such transaction.");

    if (row.entries.some((entry) => entry.account.scope !== "PLATFORM")) {
      await this.audit.record({
        action: "ledger.transaction_viewed",
        actor: { id: session.admin.id, email: session.admin.email },
        subject: { type: "ledger_transaction", id: row.id },
        after: {
          reason: row.reason,
          referenceType: row.referenceType,
          referenceId: row.referenceId,
        },
        correlationId: context.correlationId,
        ip: context.ip ?? null,
      });
    }

    const link = (t: {
      id: string;
      reason: LedgerTransactionDetail["reason"];
      createdAt: Date;
    }) => ({
      id: t.id,
      reason: t.reason,
      createdAt: t.createdAt.toISOString(),
    });
    return {
      ...toView(row),
      reverses: row.reverses ? link(row.reverses) : null,
      reversedBy: row.reversedBy.map(link),
    };
  }
}

/* --------------------------------------------------------------- plumbing */

const TRANSACTION_INCLUDE = {
  entries: {
    include: { account: { select: { code: true, scope: true } } },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.LedgerTransactionInclude;

type TransactionRow = Prisma.LedgerTransactionGetPayload<{ include: typeof TRANSACTION_INCLUDE }>;

interface StatementRow {
  id: string;
  transaction_id: string;
  direction: string;
  amount: string;
  created_at: Date;
  reason: string;
  reference_type: string;
  reference_id: string;
  balance_after: string;
}

function toSummary(row: AccountRow): LedgerAccountSummary {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    scope: row.scope,
    asset: row.asset,
    ownerId: row.ownerId,
    purpose: row.purpose,
    balance: (row.balance?.balance ?? 0n).toString(),
    allowsNegative: row.balance?.allowsNegative ?? false,
    entryCount: row.balance?.entryCount ?? 0,
    lastTransactionId: row.balance?.lastTransactionId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: (row.balance?.updatedAt ?? row.createdAt).toISOString(),
  };
}

function toView(row: TransactionRow): LedgerTransactionView {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    asset: row.asset,
    reason: row.reason,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    actorType: row.actorType,
    actorId: row.actorId,
    correlationId: row.correlationId,
    idempotencyKey: row.idempotencyKey,
    reversesTransactionId: row.reversesTransactionId,
    // Debits above credits, as a journal is read; within a side, insert order.
    entries: [...row.entries]
      .sort((a, b) =>
        a.direction === b.direction ? (a.id < b.id ? -1 : 1) : a.direction === "DEBIT" ? -1 : 1,
      )
      .map((entry) => ({
        id: entry.id,
        accountId: entry.accountId,
        accountCode: entry.account.code,
        direction: entry.direction,
        amount: entry.amount.toString(),
        signedAmount: entry.signedAmount.toString(),
      })),
  };
}
