#!/usr/bin/env node
/*
  The hand on the mock chain, from the command line.

  MockChain in the API is the control surface a test holds - mint a transfer,
  advance blocks, reorganise one away - and nothing in a deposit or withdrawal
  can reach it, which is the point: the domain works against whatever chain it
  is given. That left development with no way to make a deposit happen at all,
  so the wallet could be read but never exercised by hand. This is the
  development seed the gateway's comment always referred to.

  Usage, from the repository root:
    npm run chain -w @abay/database -- head
    npm run chain -w @abay/database -- mint <address> <usdt>
    npm run chain -w @abay/database -- advance [blocks]        (default 16)
    npm run chain -w @abay/database -- reorg <txHash> [logIndex]
    npm run chain -w @abay/database -- show <address>

  A mint alone is enough: the worker's observer finds transfers nobody told it
  about. `npm run dev:worker -w api` has to be running, or nothing will ever
  be credited.

  Refuses to run against anything but a local database. Minting USDT that
  nobody sent is a development-only power and there is no version of it that
  belongs near production data.
*/
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

/** Mirrors apps/api/src/config/env.ts. Both must agree or a mint is ignored. */
const NETWORK = "BSC";
const TOKEN_CONTRACT = envOr("USDT_CONTRACT", "0x55d398326f99059ff775485246999027b3197955");
const TOKEN_DECIMALS = BigInt(envOr("USDT_DECIMALS", "18"));
const CONFIRMATIONS = Number(envOr("DEPOSIT_CONFIRMATIONS", "15"));

function envOr(name, fallback) {
  if (process.env[name]) return process.env[name];
  try {
    const file = readFileSync(resolve(root, ".env"), "utf8");
    for (const line of file.split(/\r?\n/)) {
      const match = new RegExp(String.raw`^\s*${name}\s*=\s*(.*)$`).exec(line);
      if (match) return match[1].trim().replace(/^["'](.*)["']$/, "$1");
    }
  } catch {
    // No .env: the defaults above are the same ones the API falls back to.
  }
  return fallback;
}

function databaseUrl() {
  const url = envOr("DATABASE_URL", null);
  if (!url) throw new Error("DATABASE_URL is not set and was not found in .env");
  if (!/@(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)[:/]/.test(url)) {
    throw new Error(
      "chain.mjs refuses to run against a non-local database. This mints money that nobody sent.",
    );
  }
  return url;
}

const require = createRequire(import.meta.url);
const { PrismaClient } = require(resolve(root, "node_modules/@prisma/client"));
const db = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const address = (value) => {
  if (!ADDRESS.test(value ?? "")) throw new Error(`Not an address: ${value}`);
  return value.toLowerCase();
};

/** "12.5" USDT into the token's own integer, without ever being a float. */
function toRaw(input) {
  const text = String(input ?? "").trim();
  if (!/^\d+(\.\d{1,18})?$/.test(text)) throw new Error(`Not an amount: ${input}`);
  const [whole, fraction = ""] = text.split(".");
  const scale = 10n ** TOKEN_DECIMALS;
  return (
    BigInt(whole) * scale +
    BigInt(fraction.padEnd(Number(TOKEN_DECIMALS), "0") || "0")
  ).toString();
}

const toUsdt = (raw) => {
  const scale = 10n ** TOKEN_DECIMALS;
  const value = BigInt(raw);
  const fraction = (value % scale).toString().padStart(Number(TOKEN_DECIMALS), "0");
  return `${value / scale}.${fraction.slice(0, 6)}`;
};

/** Mirrors MockChain.mint: one transfer, in a new block, head + 1. */
async function mint(to, usdt, from) {
  const txHash = `0x${createHash("sha256").update(`dev-mint:${randomUUID()}`).digest("hex")}`;
  const row = await db.$transaction(async (tx) => {
    const head = await tx.mockChainHead.upsert({
      where: { network: NETWORK },
      create: { network: NETWORK, height: 1n },
      update: { height: { increment: 1n } },
    });
    return tx.mockChainTransfer.create({
      data: {
        network: NETWORK,
        txHash,
        logIndex: 0,
        blockNumber: head.height,
        fromAddress: from ?? `0x${"d".repeat(40)}`,
        toAddress: to,
        tokenContract: TOKEN_CONTRACT.toLowerCase(),
        rawAmount: toRaw(usdt),
        tag: "dev-chain",
      },
    });
  });
  return row;
}

const advance = (blocks) =>
  db.mockChainHead
    .upsert({
      where: { network: NETWORK },
      create: { network: NETWORK, height: BigInt(blocks) },
      update: { height: { increment: BigInt(blocks) } },
    })
    .then((head) => head.height);

async function reorg(txHash, logIndex) {
  const head = await advance(1);
  await db.mockChainTransfer.update({
    where: {
      network_txHash_logIndex: { network: NETWORK, txHash: txHash.toLowerCase(), logIndex },
    },
    data: { orphanedAtBlock: head },
  });
  return head;
}

const headHeight = async () =>
  (await db.mockChainHead.findUnique({ where: { network: NETWORK } }))?.height ?? 0n;

/** Every transfer at an address, and how near each is to being final. */
async function show(to) {
  const head = await headHeight();
  const rows = await db.mockChainTransfer.findMany({
    where: { network: NETWORK, toAddress: to },
    orderBy: { blockNumber: "asc" },
  });
  if (rows.length === 0) {
    console.log(`Nothing has been sent to ${to}.`);
    return;
  }
  console.log(`head ${head}, ${CONFIRMATIONS} confirmations to credit\n`);
  for (const row of rows) {
    const depth = head - row.blockNumber + 1n;
    const state = row.orphanedAtBlock
      ? `reorged out at block ${row.orphanedAtBlock}`
      : depth >= BigInt(CONFIRMATIONS)
        ? "final"
        : `${depth} / ${CONFIRMATIONS} confirmations`;
    console.log(`  ${toUsdt(row.rawAmount)} USDT  block ${row.blockNumber}  ${state}`);
    console.log(`    ${row.txHash}`);
  }
}

const USAGE = `The mock chain, by hand. Development only.

  npm run chain -w @abay/database -- head
  npm run chain -w @abay/database -- mint <address> <usdt> [from]
  npm run chain -w @abay/database -- advance [blocks]          (default ${CONFIRMATIONS + 1})
  npm run chain -w @abay/database -- reorg <txHash> [logIndex]
  npm run chain -w @abay/database -- show <address>

The worker has to be running for anything minted to be credited:
  npm run dev:worker -w api
`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "head": {
      console.log(`block ${await headHeight()} on ${NETWORK}`);
      break;
    }

    case "mint": {
      const to = address(rest[0]);
      const row = await mint(to, rest[1], rest[2] ? address(rest[2]) : undefined);
      console.log(`Minted ${toUsdt(row.rawAmount)} USDT to ${to} in block ${row.blockNumber}.`);
      console.log(`  ${row.txHash}`);
      console.log(
        `\nThe observer will see it within a few seconds and start counting confirmations.`,
      );
      console.log(`Then: npm run chain -w @abay/database -- advance`);
      break;
    }

    case "advance": {
      const blocks = rest[0] ? Number(rest[0]) : CONFIRMATIONS + 1;
      if (!Number.isInteger(blocks) || blocks < 1) throw new Error(`Not a block count: ${rest[0]}`);
      console.log(`Head is now block ${await advance(blocks)}.`);
      break;
    }

    case "reorg": {
      if (!rest[0]) throw new Error("Which transaction? Pass the hash mint printed.");
      const at = await reorg(rest[0], rest[1] ? Number(rest[1]) : 0);
      console.log(`Dropped from the chain at block ${at}.`);
      console.log(
        "Before finality the deposit becomes ORPHANED and nothing is credited; after it,\n" +
          "the money stays with the customer and reconciliation raises a break (AT-20).",
      );
      break;
    }

    case "show": {
      await show(address(rest[0]));
      break;
    }

    default:
      console.log(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
