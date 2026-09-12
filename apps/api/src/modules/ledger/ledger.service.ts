import { Prisma, type LedgerAccountType, type LedgerDirection } from "@abay/database";
import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { v7 as uuidv7 } from "uuid";

import { PrismaService } from "@/infra/prisma/prisma.service";
import { allowsNegative, parseAccountCode } from "@/modules/ledger/account-code";
import {
  IdempotencyConflictError,
  InsufficientFundsError,
  UnknownPlatformAccountError,
} from "@/modules/ledger/ledger.errors";
import {
  naturalDelta,
  type PostingRequest,
  type ValidatedPosting,
  validatePosting,
} from "@/modules/ledger/posting";

/*
  The only thing in the application that moves money.

  Every other module - deposits, withdrawals, escrow, adjustments - asks this
  service to post a transaction and never writes a ledger row itself (brief:
  "The Ledger module owns all monetary mutations"). What it gets back is the
  transaction and the balances it left behind, which is what a caller needs
  to show a person and nothing it could use to get the accounting wrong.

  One method does the work, and the order inside it is the design:

    validate   refuse anything malformed before touching the database
    replay     an idempotency key seen before answers with the first posting
    resolve    find the accounts, creating a customer's or a trade's on first use
    lock       SELECT ... FOR UPDATE every balance row, in ascending id order
    check      refuse an overdraw while the rows are locked, naming the account
    write      the transaction, then the entries; the trigger moves balances
    commit     the deferred trigger proves the transaction balances

  The lock order is the concurrency control (ADR-0009). Two postings that
  touch the same accounts always take the same locks in the same order, so
  they queue rather than deadlock, and the second sees the balance the first
  left. That is what makes the overdraw check final: nothing can change the
  balance between the check and the commit.
*/

export interface PostedLine {
  account: string;
  direction: LedgerDirection;
  amount: bigint;
}

export interface PostedTransaction {
  id: string;
  createdAt: Date;
  /** True when an earlier posting under the same key was found and returned. */
  replayed: boolean;
  lines: readonly PostedLine[];
  /** The balance of every account touched, by code, after the posting. Natural sense. */
  balances: Readonly<Record<string, bigint>>;
}

interface ResolvedAccount {
  id: string;
  code: string;
  type: LedgerAccountType;
}

interface LockedBalance {
  account_id: string;
  balance: bigint;
  allows_negative: boolean;
}

@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LedgerService.name);
  }

  async post(request: PostingRequest): Promise<PostedTransaction> {
    const posting = validatePosting(request);

    const earlier = await this.findByKey(posting.idempotencyKey);
    if (earlier) return this.replay(earlier, posting);

    let posted: PostedTransaction;
    try {
      posted = await this.prisma.transaction("ledger:post", (tx) => this.postWithin(tx, posting));
    } catch (error) {
      /*
        Two callers with the same key racing past the lookup above: one of
        them inserted, the other hit the unique index. The loser answers with
        the winner's transaction, exactly as it would have a moment later.
      */
      if (isUniqueViolationOn(error, "idempotency_key")) {
        const winner = await this.findByKey(posting.idempotencyKey);
        if (winner) return this.replay(winner, posting);
      }
      // The overdraw check should have caught this while the rows were
      // locked; the database's floor is the backstop for the case it did not.
      if (isFloorViolation(error)) throw new InsufficientFundsError("(unknown account)");
      throw error;
    }

    // Amounts are deliberately not logged: a specific person's rows are
    // CONFIDENTIAL (data-classification.md). The ids are enough to find them.
    this.logger.info(
      {
        event: "ledger.posted",
        transactionId: posted.id,
        reason: posting.reason,
        referenceType: posting.reference.type,
        referenceId: posting.reference.id,
        correlationId: posting.correlationId,
        lines: posted.lines.length,
      },
      "ledger transaction posted",
    );
    return posted;
  }

  /** The current balance of an account, in its natural sense. Zero for one that does not exist yet. */
  async balance(code: string): Promise<bigint> {
    parseAccountCode(code);
    const account = await this.prisma.client.ledgerAccount.findUnique({
      where: { code },
      include: { balance: true },
    });
    return account?.balance?.balance ?? 0n;
  }

  /** Makes sure an account exists, with its balance row. Safe to call repeatedly or concurrently. */
  async ensureAccount(code: string): Promise<{ id: string; code: string }> {
    const account = await this.prisma.transaction("ledger:ensure-account", (tx) =>
      this.resolveAccount(tx, code),
    );
    return { id: account.id, code: account.code };
  }

  /* ---------------------------------------------------------------- inside */

  private async postWithin(
    tx: Prisma.TransactionClient,
    posting: ValidatedPosting,
  ): Promise<PostedTransaction> {
    /*
      Accounts are resolved in code order, not line order, and this is a
      lock-ordering rule as much as the FOR UPDATE below is. Resolving may
      INSERT a brand-new account, and an uncommitted insert holds its unique
      key until commit: two postings creating the same two new accounts in
      opposite orders each wait for the other's key, and PostgreSQL has to
      kill one (found by the AT-18 property test - a customer's first hold
      and first hold-release racing, both creating AVAILABLE and
      PENDING_WITHDRAWAL). One order for everyone means no opposite order.
    */
    const byCode = new Map<string, ResolvedAccount>();
    for (const code of [...new Set(posting.lines.map((line) => line.account))].sort()) {
      byCode.set(code, await this.resolveAccount(tx, code));
    }
    const byId = new Map([...byCode.values()].map((account) => [account.id, account]));
    const ids = [...byId.keys()].sort();

    /*
      The locks, all of them, in one statement, in one order. Every balance
      this posting will move is locked before anything is written - the ones
      being credited too, because the balance trigger will UPDATE each of
      them, and two postings updating the same two rows in opposite orders is
      a deadlock. Ascending id order for everyone means there is no opposite
      order to be in.
    */
    const locked = await tx.$queryRaw<LockedBalance[]>`
      SELECT account_id, balance, allows_negative
        FROM ledger_account_balances
       WHERE account_id IN (${Prisma.join(ids)})
       ORDER BY account_id
         FOR UPDATE`;
    if (locked.length !== ids.length) {
      throw new Error(
        `ledger: ${ids.length - locked.length} account(s) have no balance row; every account is created with one`,
      );
    }

    /*
      The overdraw check, made while the rows are locked and therefore final.
      The database's floor would refuse the same posting at the trigger, but
      by then the caller would learn only that a constraint failed; here they
      learn which account, before anything has been written.
    */
    const projected = new Map(locked.map((row) => [row.account_id, row.balance]));
    for (const line of posting.lines) {
      const account = byCode.get(line.account);
      if (!account) continue;
      const current = projected.get(account.id) ?? 0n;
      projected.set(account.id, current + naturalDelta(account.type, line.direction, line.amount));
    }
    for (const row of locked) {
      const after = projected.get(row.account_id) ?? 0n;
      if (!row.allows_negative && after < 0n) {
        throw new InsufficientFundsError(byId.get(row.account_id)?.code ?? row.account_id);
      }
    }

    const transaction = await tx.ledgerTransaction.create({
      data: {
        asset: posting.asset,
        reason: posting.reason,
        referenceType: posting.reference.type,
        referenceId: posting.reference.id,
        actorType: posting.actor.type,
        actorId: posting.actor.id ?? null,
        correlationId: posting.correlationId,
        idempotencyKey: posting.idempotencyKey,
        reversesTransactionId: posting.reversesTransactionId ?? null,
      },
    });

    // Written in the lock order too, so the trigger's UPDATEs never take a
    // lock this transaction does not already hold.
    const entries = posting.lines
      .map((line) => ({
        transactionId: transaction.id,
        accountId: byCode.get(line.account)?.id ?? "",
        direction: line.direction,
        amount: line.amount,
        signedAmount: line.signedAmount,
        asset: posting.asset,
      }))
      .sort((a, b) => (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0));
    await tx.ledgerEntry.createMany({ data: entries });

    const balances = await tx.ledgerAccountBalance.findMany({ where: { accountId: { in: ids } } });

    return {
      id: transaction.id,
      createdAt: transaction.createdAt,
      replayed: false,
      lines: posting.lines.map((line) => ({
        account: line.account,
        direction: line.direction,
        amount: line.amount,
      })),
      balances: Object.fromEntries(
        balances.map((row) => [byId.get(row.accountId)?.code ?? row.accountId, row.balance]),
      ),
    };
  }

  /*
    Get or create, atomically. The INSERT ... ON CONFLICT DO NOTHING is what
    makes two first-deposits for the same new customer safe: both try, one
    wins, the other waits for that to commit and then finds it. Platform
    accounts are never created here - they are seeded by migration, and a
    missing one is a bug to raise, not a row to invent.
  */
  private async resolveAccount(
    tx: Prisma.TransactionClient,
    code: string,
  ): Promise<ResolvedAccount> {
    const descriptor = parseAccountCode(code);

    if (descriptor.scope === "PLATFORM") {
      const account = await tx.ledgerAccount.findUnique({ where: { code } });
      if (!account) throw new UnknownPlatformAccountError(code);
      return { id: account.id, code, type: account.type };
    }

    await tx.$executeRaw`
      INSERT INTO ledger_accounts (id, code, type, scope, asset, owner_id, purpose, "createdAt")
      VALUES (${uuidv7()}, ${code}, ${descriptor.type}::ledger_account_type,
              ${descriptor.scope}::ledger_account_scope, ${descriptor.asset}::ledger_asset,
              ${descriptor.ownerId}, ${descriptor.purpose}, now())
      ON CONFLICT (code) DO NOTHING`;
    const account = await tx.ledgerAccount.findUniqueOrThrow({ where: { code } });
    await tx.$executeRaw`
      INSERT INTO ledger_account_balances
        (account_id, asset, balance, allows_negative, entry_count, last_transaction_id, version, "updatedAt")
      VALUES (${account.id}, ${descriptor.asset}::ledger_asset, 0, ${allowsNegative(descriptor.type)},
              0, NULL, 0, now())
      ON CONFLICT (account_id) DO NOTHING`;
    return { id: account.id, code, type: account.type };
  }

  /* ----------------------------------------------------------- idempotency */

  private findByKey(idempotencyKey: string): Promise<Existing | null> {
    return this.prisma.client.ledgerTransaction.findUnique({
      where: { idempotencyKey },
      include: EXISTING_INCLUDE,
    });
  }

  /*
    The same key again. If it is the same posting, that is a retry - a
    webhook redelivered, a button pressed twice - and the right answer is the
    transaction that already exists. If it is a different posting under a key
    that was already spent, that is a caller's bug, and the right answer is
    to stop them before a second event is silently swallowed as a retry.
  */
  private replay(existing: Existing, posting: ValidatedPosting): PostedTransaction {
    const shape = (lines: readonly { account: string; direction: string; amount: bigint }[]) =>
      lines
        .map((line) => `${line.account}|${line.direction}|${line.amount.toString()}`)
        .sort()
        .join(";");
    const existingLines = existing.entries.map((entry) => ({
      account: entry.account.code,
      direction: entry.direction,
      amount: entry.amount,
    }));
    const same =
      existing.reason === posting.reason &&
      existing.asset === posting.asset &&
      existing.referenceType === posting.reference.type &&
      existing.referenceId === posting.reference.id &&
      shape(existingLines) === shape(posting.lines);
    if (!same) throw new IdempotencyConflictError(posting.idempotencyKey, existing.id);

    return {
      id: existing.id,
      createdAt: existing.createdAt,
      replayed: true,
      lines: existingLines,
      balances: Object.fromEntries(
        existing.entries.map((entry) => [entry.account.code, entry.account.balance?.balance ?? 0n]),
      ),
    };
  }
}

/* --------------------------------------------------------------- plumbing */

const EXISTING_INCLUDE = {
  entries: { include: { account: { include: { balance: true } } } },
} satisfies Prisma.LedgerTransactionInclude;

type Existing = Prisma.LedgerTransactionGetPayload<{ include: typeof EXISTING_INCLUDE }>;

function isUniqueViolationOn(error: unknown, column: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    JSON.stringify(error.meta ?? {}).includes(column)
  );
}

function isFloorViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const meta = (error as { meta?: unknown }).meta;
  return `${error.message} ${JSON.stringify(meta ?? "")}`.includes("ledger_account_balances_floor");
}
