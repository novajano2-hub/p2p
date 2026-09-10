#!/usr/bin/env node
/*
  Approve or reject a pending KYC submission from the command line.

  A STAND-IN, not the product. The real review belongs to the admin realm
  (Phase 1 step 3) with its own accounts, its own session and its own audit
  log; until that exists this is how a submission gets a decision, and it
  writes the same rows the admin tooling will.

  The photographs are listed by their storage key. With Cloudflare R2 (or any
  S3-compatible store) open the bucket in the provider's console and browse to
  the key; with nothing configured they are files under apps/api/.storage.

  Usage, from the repository root:
    node packages/database/scripts/review-kyc.mjs list
    node packages/database/scripts/review-kyc.mjs approve BQ-12345678
    node packages/database/scripts/review-kyc.mjs reject  BQ-12345678 "Name does not match the document"
*/
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

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
const db = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });

const [command, platformId, ...rest] = process.argv.slice(2);
const reason = rest.join(" ").trim();

async function main() {
  if (command === "list") {
    const waiting = await db.user.findMany({
      where: { kycStatus: "PENDING" },
      select: {
        platformId: true,
        username: true,
        email: true,
        kycSubmissions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            legalName: true,
            dateOfBirth: true,
            country: true,
            documentType: true,
            documentNumber: true,
            createdAt: true,
            documents: {
              orderBy: { kind: "asc" },
              select: { kind: true, storageKey: true, sizeBytes: true },
            },
          },
        },
      },
      orderBy: { updatedAt: "asc" },
    });
    if (waiting.length === 0) {
      console.log("Nothing waiting for review.");
      return;
    }
    for (const user of waiting) {
      const submission = user.kycSubmissions[0];
      console.log(`${user.platformId}  ${user.username}  <${user.email}>`);
      if (submission) {
        console.log(
          `   ${submission.legalName}  ${submission.dateOfBirth.toISOString().slice(0, 10)}` +
            `  ${submission.country}  ${submission.documentType}  ${submission.documentNumber}`,
        );
        console.log(`   submitted ${submission.createdAt.toISOString()}`);
        for (const document of submission.documents) {
          const kilobytes = Math.round(document.sizeBytes / 1024);
          console.log(`   ${document.kind.padEnd(6)}  ${document.storageKey}  (${kilobytes} KB)`);
        }
      }
    }
    return;
  }

  if (command !== "approve" && command !== "reject") {
    console.error("Usage: review-kyc.mjs list | approve <BQ-...> | reject <BQ-...> [reason]");
    process.exitCode = 1;
    return;
  }
  if (!platformId) {
    console.error("Which account? Pass its BQ- number.");
    process.exitCode = 1;
    return;
  }
  if (command === "reject" && !reason) {
    console.error("A rejection needs a reason: it is shown to the customer.");
    process.exitCode = 1;
    return;
  }

  const user = await db.user.findUnique({
    where: { platformId },
    select: { id: true, kycStatus: true },
  });
  if (!user) {
    console.error(`No account with platform id ${platformId}.`);
    process.exitCode = 1;
    return;
  }

  const submission = await db.kycSubmission.findFirst({
    where: { userId: user.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!submission) {
    console.error(`${platformId} has no submission waiting (status is ${user.kycStatus}).`);
    process.exitCode = 1;
    return;
  }

  const approved = command === "approve";
  await db.$transaction([
    db.kycSubmission.update({
      where: { id: submission.id },
      data: {
        status: approved ? "APPROVED" : "REJECTED",
        reviewedAt: new Date(),
        // Who decided. The admin realm will put a real administrator here.
        reviewedBy: process.env.USERNAME ?? process.env.USER ?? "cli",
        rejectionReason: approved ? null : reason,
      },
    }),
    db.user.update({
      where: { id: user.id },
      data: { kycStatus: approved ? "APPROVED" : "REJECTED" },
    }),
  ]);

  console.log(`${platformId} is now ${approved ? "APPROVED" : "REJECTED"}.`);
}

try {
  await main();
} finally {
  await db.$disconnect();
}
