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

module.exports = async function teardown() {
  // Required lazily: a unit-only run has no reason to load Prisma at all.
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: databaseUrl() });

  try {
    const users = await db.user.findMany({ select: { id: true, email: true } });
    const test = users.filter((user) => TEST_USER.test(user.email));

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

    const cleared = test.length + testAdmins.length;
    if (cleared > 0) {
      console.log(
        `[teardown] cleared ${test.length} test customer(s) and ${testAdmins.length} test admin(s)`,
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
