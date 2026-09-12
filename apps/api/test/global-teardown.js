/*
  Removes everything the API tests created, after every run.

  These tests deliberately run against a real PostgreSQL rather than a mock,
  which is what makes them worth having - and the cost of that, until this
  file existed, was a development database filling up with hundreds of
  "Abebe Bikila" submissions and test administrators that someone then had to
  recognise and clear by hand.

  Matching is by the exact shapes the fixtures mint (helpers.ts uniqueEmail,
  and makeAdmin in admin.spec.ts), anchored at both ends. A real account
  cannot collide with them: nobody signs up as
  test-1789051541513-0kpy82@example.com. Deliberately NOT "delete everything",
  because this runs against a database that also holds whatever the owner has
  been doing by hand.

  Deleting a User cascades to their identities, sessions, submissions,
  documents and notifications (see schema.prisma). Two things it does not
  reach, handled here: verification tokens, which are keyed by address rather
  than by a foreign key, and the photographs on disk, which no database
  cascade knows about.

  Audit events are left alone on purpose. They are append-only, by a database
  trigger, and a delete would be refused - which is the guarantee working, not
  a problem to route around.
*/
const { existsSync, readFileSync, rmSync } = require("node:fs");
const path = require("node:path");

const TEST_USER = /^test-\d+-[a-z0-9]+@example\.com$/;
const TEST_ADMIN = /^admin-\d+-[a-z0-9]+@example\.com$/;

/*
  globalTeardown runs OUTSIDE the test environment, so setup-env.ts has not
  run here and process.env holds only what the shell had. The URL is resolved
  the way every script in this repository resolves it: the environment first,
  then the one .env at the repository root.
*/
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const file = readFileSync(path.resolve(__dirname, "../../../.env"), "utf8");
    for (const line of file.split(/\r?\n/)) {
      const match = /^\s*DATABASE_URL\s*=\s*(.*)$/.exec(line);
      if (match) return match[1].trim().replace(/^["'](.*)["']$/, "$1");
    }
  } catch {
    // Falls through to the default below, which matches docker-compose.yml.
  }
  return "postgresql://abay_app:app@localhost:5433/abay?schema=public";
}

/*
  The ledger cleanup needs the MIGRATOR role, not the application one.
  Posted ledger history is immutable to the application role by GRANT and to
  everyone else by trigger; only the table owner can disable that trigger for
  a moment, and the owner is the migrator. Resolved the same way as
  databaseUrl(): the environment first, then the one .env at the root.
*/
function directDatabaseUrl() {
  if (process.env.DIRECT_DATABASE_URL) return process.env.DIRECT_DATABASE_URL;
  try {
    const file = readFileSync(path.resolve(__dirname, "../../../.env"), "utf8");
    for (const raw of file.split(String.fromCharCode(10))) {
      const line = raw.trim();
      if (line.startsWith("DIRECT_DATABASE_URL=")) {
        return line
          .slice("DIRECT_DATABASE_URL=".length)
          .trim()
          .replace(/^["](.*)["]$/, "$1");
      }
    }
  } catch {
    // Falls through to the default below, which matches docker-compose.yml.
  }
  return "postgresql://abay_migrator:migrator@localhost:5433/abay?schema=public";
}

module.exports = async function teardown() {
  // Required lazily: a unit-only run has no reason to load Prisma at all.
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: databaseUrl() });

  try {
    const users = await db.user.findMany({ select: { id: true, email: true } });
    const test = users.filter((user) => TEST_USER.test(user.email));
    const testUserIds = test.map((user) => user.id);

    // What the deposit tests left, found before the customers go: a deposit
    // cascades with its owner, but the ledger rows it posted do not.
    const taggedTransfers = await db.mockChainTransfer.findMany({
      where: { OR: [{ tag: { startsWith: "test-" } }, { tag: { startsWith: "custody:test-" } }] },
      select: { txHash: true },
    });
    const testDeposits = await db.deposit.findMany({
      where: {
        OR: [
          { userId: { in: testUserIds } },
          { txHash: { in: taggedTransfers.map((t) => t.txHash) } },
          { correlationId: { startsWith: "test-" } },
        ],
      },
      select: { id: true },
    });

    if (test.length > 0) {
      const ids = test.map((user) => user.id);

      // Files first: no cascade reaches the object store.
      const root = path.resolve(process.cwd(), process.env.STORAGE_LOCAL_DIR ?? ".storage", "kyc");
      for (const id of ids) {
        const dir = path.join(root, id);
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      }

      await db.verificationToken.deleteMany({
        where: { email: { in: test.map((user) => user.email) } },
      });
      await db.user.deleteMany({ where: { id: { in: ids } } });
    }

    const admins = await db.adminUser.findMany({ select: { id: true, email: true } });
    const testAdmins = admins.filter((admin) => TEST_ADMIN.test(admin.email));
    if (testAdmins.length > 0) {
      await db.adminUser.deleteMany({ where: { id: { in: testAdmins.map((a) => a.id) } } });
    }

    const ledger = await clearTestLedgerRows({
      depositIds: testDeposits.map((d) => d.id),
      ownerIds: testUserIds,
    });

    // Phase 3 rows the tests tagged as theirs. Deposits, withdrawals and
    // idempotency keys hang off the test customers deleted above and went
    // with them; these three tables are not owned by anybody.
    const outbox = await db.outboxEvent.deleteMany({
      where: { correlationId: { startsWith: "test-" } },
    });
    // Deposits without an owner do not cascade with a customer.
    await db.deposit.deleteMany({ where: { id: { in: testDeposits.map((d) => d.id) } } });
    const chain = await db.mockChainTransfer.deleteMany({
      where: { OR: [{ tag: { startsWith: "test-" } }, { tag: { startsWith: "custody:test-" } }] },
    });
    await db.mockCustodyDirective.deleteMany({ where: { clientRef: { startsWith: "test-" } } });

    const cleared = test.length + testAdmins.length;
    if (cleared > 0 || ledger > 0 || outbox.count > 0 || chain.count > 0) {
      console.log(
        `[teardown] cleared ${test.length} test customer(s), ${testAdmins.length} test admin(s), ${ledger} test ledger transaction(s), ${outbox.count} outbox event(s) and ${chain.count} mock chain transfer(s)`,
      );
    }
  } catch (error) {
    // Never fail a green run over cleanup: the tests already passed, and a
    // database that cannot be reached here is a problem the run itself would
    // have reported first.
    console.warn("[teardown] could not clear test data:", error);
  } finally {
    await db.$disconnect();
  }
};

/*
  Ledger rows the tests posted, and only those.

  A test transaction is one whose correlation id starts with "test-", and a
  test account is one whose owner id does - both by construction in
  test/api/ledger.spec.ts, and neither a shape anything real produces. The
  eleven platform accounts are never touched; they are the same rows in every
  environment and the tests post against them like everything else will.

  Deleting posted history takes the migrator disabling its own trigger, which
  is the "deliberate act" that trigger's comment refers to, and is why this
  runs as that role rather than the application's. Reversing transactions go
  before the ones they reverse, because the self-reference is RESTRICT.

  Afterwards every remaining balance is rebuilt from the entries that are
  left: the platform accounts the tests moved money through would otherwise
  keep a balance for history that no longer exists. The projection is a cache
  of the entries (ADR-0009), and this is that fact being relied on.
*/
/** A SQL list of ids, each checked to be an id before it is interpolated. */
function sqlList(ids) {
  const safe = ids.filter((id) => /^[0-9a-fA-F-]{36}$/.test(id));
  return safe.length > 0 ? safe.map((id) => `'${id}'`).join(", ") : "''";
}

async function clearTestLedgerRows({ depositIds = [], ownerIds = [] } = {}) {
  const { PrismaClient } = require("@prisma/client");
  const direct = new PrismaClient({ datasourceUrl: directDatabaseUrl() });
  // Also any posting whose deposit is already gone: a run that was cut off
  // before this ran would otherwise leave rows that make a rebuild impossible.
  const testTx = `(correlation_id LIKE 'test-%'
      OR (reference_type = 'deposit' AND reference_id IN (${sqlList(depositIds)}))
      OR (reference_type = 'deposit' AND reference_id NOT IN (SELECT id FROM deposits)))`;
  const testAccount = `(owner_id LIKE 'test-%' OR owner_id IN (${sqlList(ownerIds)}))`;
  try {
    const [{ n }] = await direct.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM ledger_transactions WHERE ${testTx}`,
    );
    const [{ a }] = await direct.$queryRawUnsafe(
      `SELECT count(*)::int AS a FROM ledger_accounts WHERE ${testAccount}`,
    );
    if (n === 0 && a === 0) return 0;

    // One transaction, so that a failure part-way leaves the ledger as it
    // was rather than half-cleared: DDL is transactional in PostgreSQL, so
    // the disabled triggers come back either way.
    await direct.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_no_delete",
      );
      await tx.$executeRawUnsafe(
        "ALTER TABLE ledger_transactions DISABLE TRIGGER ledger_transactions_no_delete",
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM ledger_entries WHERE transaction_id IN (SELECT id FROM ledger_transactions WHERE ${testTx})`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM ledger_transactions WHERE ${testTx} AND reverses_transaction_id IS NOT NULL`,
      );
      await tx.$executeRawUnsafe(`DELETE FROM ledger_transactions WHERE ${testTx}`);
      await tx.$executeRawUnsafe(
        "ALTER TABLE ledger_entries ENABLE TRIGGER ledger_entries_no_delete",
      );
      await tx.$executeRawUnsafe(
        "ALTER TABLE ledger_transactions ENABLE TRIGGER ledger_transactions_no_delete",
      );

      await tx.$executeRawUnsafe(
        `DELETE FROM ledger_account_balances WHERE account_id IN (SELECT id FROM ledger_accounts WHERE ${testAccount})`,
      );
      await tx.$executeRawUnsafe(`DELETE FROM ledger_accounts WHERE ${testAccount}`);

      await tx.$executeRawUnsafe(`
        UPDATE ledger_account_balances b
           SET balance = COALESCE(r.balance, 0),
               entry_count = COALESCE(r.n, 0),
               last_transaction_id = r.last_tx,
               version = b.version + 1
          FROM ledger_accounts a
          LEFT JOIN (
            SELECT e.account_id,
                   SUM(CASE WHEN ac.type IN ('ASSET', 'EXPENSE') THEN e.signed_amount ELSE -e.signed_amount END) AS balance,
                   COUNT(*)::int AS n,
                   (array_agg(e.transaction_id ORDER BY e.id DESC))[1] AS last_tx
              FROM ledger_entries e JOIN ledger_accounts ac ON ac.id = e.account_id
             GROUP BY e.account_id
          ) r ON r.account_id = a.id
         WHERE b.account_id = a.id`);
    });
    return n;
  } finally {
    await direct.$disconnect();
  }
}
