#!/usr/bin/env node
/*
  Administrator accounts, from the command line.

  There is no sign-up route into the admin realm and there should never be
  one: the accounts that can read identity documents and, later, approve
  withdrawals are issued deliberately by someone with database access, not
  created by anyone who can reach a URL. This script is that act.

  Usage, from the repository root:
    npm run admin -w @abay/database -- list
    npm run admin -w @abay/database -- create you@example.com "Your Name" KYC_REVIEWER
    npm run admin -w @abay/database -- roles you@example.com KYC_REVIEWER,DISPUTE_RESOLVER
    npm run admin -w @abay/database -- suspend you@example.com
    npm run admin -w @abay/database -- activate you@example.com
    npm run admin -w @abay/database -- mfa-reset you@example.com

  mfa-reset is the lost-phone path, and deliberately the ONLY one: it strips
  the second factor, ends every session, and leaves the account password-only
  until its owner enrolls again at next sign-in. It lives here, beside
  create, because recovery must require what issuing does - a person at this
  machine - and never a URL.

  The password is never an argument: it would be in your shell history and in
  the process list. It is prompted for, or read from ADMIN_PASSWORD.
*/
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

const ROLES = [
  "KYC_REVIEWER",
  "DISPUTE_RESOLVER",
  "WITHDRAWAL_APPROVER",
  "FINANCIAL_ADJUSTER",
  "LEDGER_VIEWER",
];
/** Longer than the customer rule. These accounts are worth more to an attacker. */
const MIN_PASSWORD = 12;

/** The one env file, at the repository root. */
function databaseUrl() {
  if (process.env.DIRECT_DATABASE_URL) return process.env.DIRECT_DATABASE_URL;
  const file = readFileSync(resolve(root, ".env"), "utf8");
  for (const line of file.split(/\r?\n/)) {
    const match = /^\s*DIRECT_DATABASE_URL\s*=\s*(.*)$/.exec(line);
    if (match) return match[1].trim().replace(/^["'](.*)["']$/, "$1");
  }
  throw new Error("DIRECT_DATABASE_URL is not set and was not found in .env");
}

const require = createRequire(import.meta.url);
const { PrismaClient } = require(resolve(root, "node_modules/@prisma/client"));
const argon2 = require(resolve(root, "node_modules/argon2"));
const db = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });

/** Matches apps/api/src/modules/auth/tokens.ts. Both must agree or nobody can sign in. */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

function readPassword() {
  if (process.env.ADMIN_PASSWORD) return Promise.resolve(process.env.ADMIN_PASSWORD);
  if (!process.stdin.isTTY) {
    throw new Error("No terminal to prompt on. Set ADMIN_PASSWORD instead.");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((done) => {
    // Echo off, so the password is not left on screen or in a screen share.
    rl.output.write("Password: ");
    rl.input.setRawMode?.(true);
    let value = "";
    rl.input.on("data", function onData(chunk) {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          rl.input.setRawMode?.(false);
          rl.input.removeListener("data", onData);
          rl.output.write("\n");
          rl.close();
          done(value);
          return;
        }
        if (ch === "") process.exit(1);
        if (ch === "") value = value.slice(0, -1);
        else value += ch;
      }
    });
  });
}

function parseRoles(raw) {
  if (!raw) return [];
  const roles = raw
    .split(",")
    .map((role) => role.trim().toUpperCase())
    .filter(Boolean);
  const unknown = roles.filter((role) => !ROLES.includes(role));
  if (unknown.length > 0) {
    throw new Error(`Unknown role(s): ${unknown.join(", ")}. Known: ${ROLES.join(", ")}`);
  }
  return roles;
}

const [command, ...rest] = process.argv.slice(2);

async function main() {
  if (command === "list") {
    const admins = await db.adminUser.findMany({ orderBy: { createdAt: "asc" } });
    if (admins.length === 0) {
      console.log("No administrators yet. Create one with `create`.");
      return;
    }
    for (const admin of admins) {
      const roles = admin.roles.length > 0 ? admin.roles.join(", ") : "(no roles: can do nothing)";
      const seen = admin.lastSignedInAt
        ? `last in ${admin.lastSignedInAt.toISOString()}`
        : "never signed in";
      const mfa = admin.totpEnrolledAt ? "MFA on" : "MFA NOT SET UP";
      console.log(`${admin.email}  ${admin.name}  [${admin.status}]  [${mfa}]  ${roles}  ${seen}`);
    }
    return;
  }

  if (command === "create") {
    const [emailRaw, name, rolesRaw] = rest;
    if (!emailRaw || !name) {
      throw new Error('Usage: create <email> "<name>" [ROLE,ROLE]');
    }
    const email = emailRaw.trim().toLowerCase();
    const roles = parseRoles(rolesRaw);

    if (await db.adminUser.findUnique({ where: { email } })) {
      throw new Error(`${email} is already an administrator.`);
    }

    const password = await readPassword();
    if (password.length < MIN_PASSWORD) {
      throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
    }

    const admin = await db.adminUser.create({
      data: {
        email,
        name,
        passwordHash: await argon2.hash(password, ARGON2_OPTIONS),
        passwordChangedAt: new Date(),
        roles,
      },
    });
    console.log(`Created ${admin.email}.`);
    if (roles.length === 0) {
      console.log("It has no roles, so it can sign in and do nothing. Grant some with `roles`.");
    }
    return;
  }

  if (command === "roles") {
    const [emailRaw, rolesRaw] = rest;
    if (!emailRaw)
      throw new Error("Usage: roles <email> <ROLE,ROLE>   (an empty list removes all)");
    const email = emailRaw.trim().toLowerCase();
    const roles = parseRoles(rolesRaw);
    const admin = await db.adminUser.update({ where: { email }, data: { roles } });
    console.log(`${admin.email} now has: ${roles.length > 0 ? roles.join(", ") : "nothing"}.`);
    return;
  }

  if (command === "suspend" || command === "activate") {
    const [emailRaw] = rest;
    if (!emailRaw) throw new Error(`Usage: ${command} <email>`);
    const email = emailRaw.trim().toLowerCase();
    const status = command === "suspend" ? "SUSPENDED" : "ACTIVE";
    const admin = await db.adminUser.update({ where: { email }, data: { status } });
    if (status === "SUSPENDED") {
      // Suspending someone who is signed in has to end the session they are
      // in, not only stop the next one.
      const { count } = await db.adminSession.updateMany({
        where: { adminUserId: admin.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "REVOKED_BY_ADMIN" },
      });
      console.log(`${admin.email} suspended; ${count} session(s) ended.`);
    } else {
      console.log(`${admin.email} is active again.`);
    }
    return;
  }

  if (command === "mfa-reset") {
    const [emailRaw] = rest;
    if (!emailRaw) throw new Error("Usage: mfa-reset <email>");
    const email = emailRaw.trim().toLowerCase();
    const admin = await db.adminUser.update({
      where: { email },
      data: {
        totpSecret: null,
        totpPendingSecret: null,
        totpEnrolledAt: null,
        totpLastUsedStep: null,
      },
    });
    // Every session, current ones included: whoever holds one may be exactly
    // the reason the factor is being reset.
    const { count } = await db.adminSession.updateMany({
      where: { adminUserId: admin.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "REVOKED_BY_ADMIN" },
    });
    // The trail must say this happened. The trigger allows inserts only, so
    // this writes the same append-only table the API writes.
    await db.auditEvent.create({
      data: {
        action: "admin.mfa_reset",
        actorAdminId: null,
        actorEmail: "cli",
        subjectType: "admin_user",
        subjectId: admin.id,
        reason: "mfa-reset from the command line",
        correlationId: `cli-${Date.now()}`,
        ip: null,
      },
    });
    console.log(
      `${admin.email}: second factor removed, ${count} session(s) ended. ` +
        "They sign in with their password alone next time, and are held at enrollment until a new app is set up.",
    );
    return;
  }

  console.error(
    "Usage: admin.mjs list | create <email> <name> [ROLES] | roles <email> <ROLES> | suspend <email> | activate <email> | mfa-reset <email>",
  );
  process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
