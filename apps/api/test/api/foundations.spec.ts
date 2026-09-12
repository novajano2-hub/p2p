import { createHash } from "node:crypto";

import { createPrismaClient, type PrismaClient } from "@abay/database";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import type request from "supertest";

import { createApp } from "@/app";
import {
  IdempotencyConflictError,
  IdempotencyService,
  requestHash,
} from "@/common/idempotency/idempotency.service";
import { assertNoOpenTransaction, IoInsideTransactionError } from "@/common/io/transaction-scope";
import { loadEnv } from "@/config/env";
import { PrismaService } from "@/infra/prisma/prisma.service";
import {
  BLOCKCHAIN_GATEWAY,
  type BlockchainGateway,
} from "@/modules/blockchain/blockchain.gateway";
import { MockChain } from "@/modules/blockchain/mock/mock-blockchain.gateway";
import { CUSTODY_PROVIDER, type CustodyProvider } from "@/modules/custody/custody.provider";
import { MockCustodyProvider } from "@/modules/custody/mock/mock-custody.provider";
import { MAX_ATTEMPTS, OutboxService } from "@/modules/outbox/outbox.service";

import { registerFully, uniqueEmail } from "./helpers";

/*
  Phase 3's foundations against the real database: the mock chain and
  custody provider behave like the real ones must (idempotent on a client
  reference, honest about "unknown"), the outbox commits with its
  transaction and delivers outside one, and an Idempotency-Key does its work
  exactly once however it is retried.

  Every tag, correlation id and client reference here starts with "test-",
  which is how global-teardown.js knows which rows are its to clear.
*/

let app: NestFastifyApplication;
let db: PrismaClient;
let prisma: PrismaService;
let chain: MockChain;
let gateway: BlockchainGateway;
let custody: CustodyProvider;
let mockCustody: MockCustodyProvider;
let outbox: OutboxService;
let idempotency: IdempotencyService;
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let counter = 0;
const uniq = (label: string) => `test-${run}-${label}-${++counter}`;
// Addresses unique to this run: a fixed address would sum with rows an
// interrupted earlier run left behind for the teardown to find.
const addr = (seed: string) =>
  `0x${createHash("sha256").update(`${run}:${seed}`).digest("hex").slice(0, 40)}`;
const USDT18 = 10n ** 18n;

const delivered: string[] = [];

beforeAll(async () => {
  const env = loadEnv();
  app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createPrismaClient(env.DATABASE_URL);
  prisma = app.get(PrismaService);
  chain = app.get(MockChain);
  gateway = app.get(BLOCKCHAIN_GATEWAY);
  custody = app.get(CUSTODY_PROVIDER);
  mockCustody = app.get(MockCustodyProvider);
  outbox = app.get(OutboxService);
  idempotency = app.get(IdempotencyService);

  outbox.register("test.ok", (payload) => {
    // Delivery happens outside any transaction, or this throws (AT-19).
    assertNoOpenTransaction("delivering a test event");
    delivered.push((payload as { id: string }).id);
    return Promise.resolve();
  });
  outbox.register("test.fail", () => Promise.reject(new Error("the provider is down")));
});

afterAll(async () => {
  await db.$disconnect();
  await app.close();
});

describe("the mock chain", () => {
  it("holds what is minted, advances, and forgets what is reorged away", async () => {
    const to = addr("a1");
    const before = await gateway.headBlock("BSC");
    const minted = await chain.mint({ to, rawAmount: 5n * USDT18, tag: uniq("mint") });
    expect(minted.blockNumber).toBe(before + 1n);
    expect(minted.to).toBe(to);

    const found = await gateway.findTransfer("BSC", minted.txHash.toUpperCase(), 0);
    expect(found?.rawAmount).toBe(5n * USDT18);
    expect(await gateway.transfersTo("BSC", [to.toUpperCase()], before)).toHaveLength(1);

    expect(await chain.advance(15)).toBe(before + 16n);
    expect(await gateway.headBlock("BSC")).toBe(before + 16n);

    await chain.reorg(minted.txHash);
    expect(await gateway.findTransfer("BSC", minted.txHash, 0)).toBeNull();
    expect(await gateway.transfersTo("BSC", [to], before)).toHaveLength(0);
  });

  it("balances an address from what came in minus what went out", async () => {
    const wallet = addr("b2");
    const elsewhere = addr("b3");
    await chain.mint({ to: wallet, rawAmount: 10n * USDT18, tag: uniq("in") });
    await chain.mint({ to: wallet, rawAmount: 3n * USDT18, tag: uniq("in") });
    await chain.mint({ from: wallet, to: elsewhere, rawAmount: 4n * USDT18, tag: uniq("out") });
    expect(await gateway.tokenBalance("BSC", wallet)).toBe(9n * USDT18);
    expect(await gateway.tokenBalance("BSC", elsewhere)).toBe(4n * USDT18);
  });

  it("AT-19: refuses to be read from inside a transaction", async () => {
    await expect(
      prisma.transaction("test-scope", () => gateway.headBlock("BSC")),
    ).rejects.toBeInstanceOf(IoInsideTransactionError);
  });
});

describe("the mock custody provider", () => {
  it("issues one deterministic, well-formed address per customer", async () => {
    const a = await custody.createDepositAddress({ userId: "u-1", network: "BSC", asset: "USDT" });
    const again = await custody.createDepositAddress({
      userId: "u-1",
      network: "BSC",
      asset: "USDT",
    });
    const b = await custody.createDepositAddress({ userId: "u-2", network: "BSC", asset: "USDT" });
    expect(a.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(again.address).toBe(a.address);
    expect(b.address).not.toBe(a.address);
  });

  it("broadcasts once per client reference, however many times it is asked", async () => {
    const ref = uniq("wd");
    const to = addr("c1");
    const first = await custody.transfer({
      clientRef: ref,
      network: "BSC",
      asset: "USDT",
      from: { treasury: "HOT" },
      to,
      rawAmount: 2n * USDT18,
    });
    const second = await custody.transfer({
      clientRef: ref,
      network: "BSC",
      asset: "USDT",
      from: { treasury: "HOT" },
      to,
      rawAmount: 2n * USDT18,
    });
    expect(first.kind).toBe("BROADCAST");
    expect(second).toEqual(first);
    if (first.kind !== "BROADCAST") throw new Error("unreachable");

    const onChain = await gateway.findTransfer("BSC", first.txHash, 0);
    expect(onChain?.to).toBe(to);
    expect(onChain?.from).toBe(await custody.treasuryAddress("BSC", "HOT"));
    expect(await db.mockChainTransfer.count({ where: { tag: `custody:${ref}` } })).toBe(1);
  });

  it("can be directed to refuse, or to answer unknown with or without having sent", async () => {
    const send = (ref: string) =>
      custody.transfer({
        clientRef: ref,
        network: "BSC",
        asset: "USDT",
        from: { treasury: "HOT" },
        to: addr("c2"),
        rawAmount: USDT18,
      });

    const refused = uniq("refused");
    await mockCustody.direct(refused, "REFUSED");
    expect((await send(refused)).kind).toBe("REFUSED");
    expect(await db.mockChainTransfer.count({ where: { tag: `custody:${refused}` } })).toBe(0);

    const dropped = uniq("dropped");
    await mockCustody.direct(dropped, "UNKNOWN_DROPPED");
    expect(await send(dropped)).toEqual({ kind: "UNKNOWN", providerRef: null });
    expect(await db.mockChainTransfer.count({ where: { tag: `custody:${dropped}` } })).toBe(0);

    // The case AT-9 turns on: the provider says "unknown" but the coins did leave.
    const sent = uniq("sent");
    await mockCustody.direct(sent, "UNKNOWN_BROADCAST");
    expect((await send(sent)).kind).toBe("UNKNOWN");
    expect(await db.mockChainTransfer.count({ where: { tag: `custody:${sent}` } })).toBe(1);
  });

  it("AT-19: refuses to be called from inside a transaction", async () => {
    await expect(
      prisma.transaction("test-scope", () =>
        custody.createDepositAddress({ userId: "u", network: "BSC", asset: "USDT" }),
      ),
    ).rejects.toBeInstanceOf(IoInsideTransactionError);
  });
});

describe("the outbox", () => {
  const enqueue = (type: string, id: string) =>
    prisma.transaction("test-enqueue", (tx) =>
      outbox.enqueue(tx, { type, payload: { id }, correlationId: uniq("corr") }),
    );

  it("sends what committed, once, outside any transaction; and nothing that rolled back", async () => {
    const id = uniq("event");
    const eventId = await enqueue("test.ok", id);

    const lost = uniq("lost");
    await expect(
      prisma.transaction("test-rollback", async (tx) => {
        await outbox.enqueue(tx, {
          type: "test.ok",
          payload: { id: lost },
          correlationId: uniq("c"),
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    await outbox.drain();
    await outbox.drain();
    expect(delivered.filter((d) => d === id)).toHaveLength(1);
    expect(delivered).not.toContain(lost);
    const row = await db.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(row.status).toBe("SENT");
    expect(row.attempts).toBe(1);
  });

  it("retries a failed delivery later with backoff, and gives up after the last attempt", async () => {
    const eventId = await enqueue("test.fail", uniq("event"));
    const started = Date.now();
    await outbox.drain();
    const after = await db.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(after.status).toBe("PENDING");
    expect(after.attempts).toBe(1);
    expect(after.lastError).toBe("the provider is down");
    expect(after.availableAt.getTime()).toBeGreaterThan(started + 20_000);

    // Not due yet: a second pass leaves it alone.
    await outbox.drain();
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: eventId } })).attempts).toBe(1);

    await db.outboxEvent.update({
      where: { id: eventId },
      data: { attempts: MAX_ATTEMPTS - 1, availableAt: new Date(0) },
    });
    await outbox.drain();
    const done = await db.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(done.status).toBe("FAILED");
    expect(done.attempts).toBe(MAX_ATTEMPTS);
  });

  it("refuses a second handler for the same type", () => {
    expect(() => {
      outbox.register("test.ok", () => Promise.resolve());
    }).toThrow(/already registered/);
  });
});

describe("idempotency keys", () => {
  let userId: string;
  beforeAll(async () => {
    userId = (await registerFully(server(), db, uniqueEmail())).userId;
  });

  const scope = (key: string, body: unknown, endpoint = "withdrawals.create") => ({
    userId,
    endpoint,
    key,
    requestHash: requestHash(body),
  });

  it("does the work once and answers a repeat from the stored response", async () => {
    let runs = 0;
    const work = () => {
      runs += 1;
      return Promise.resolve({ status: 201, body: { withdrawalId: "w-1", runs } });
    };
    const key = uniq("key");
    const first = await idempotency.execute(scope(key, { amount: "5" }), work);
    const second = await idempotency.execute(scope(key, { amount: "5" }), work);
    expect(first).toEqual({ status: 201, body: { withdrawalId: "w-1", runs: 1 }, replayed: false });
    expect(second).toEqual({ status: 201, body: { withdrawalId: "w-1", runs: 1 }, replayed: true });
    expect(runs).toBe(1);
    expect(await db.idempotencyKey.count({ where: { userId, key } })).toBe(1);
  });

  it("refuses the same key with a different body rather than replaying the wrong answer", async () => {
    const key = uniq("key");
    await idempotency.execute(scope(key, { amount: "5" }), () =>
      Promise.resolve({ status: 201, body: { ok: true } }),
    );
    await expect(
      idempotency.execute(scope(key, { amount: "6" }), () =>
        Promise.resolve({ status: 201, body: { ok: true } }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    // The body is compared by content, not by the order it was typed in.
    const same = await idempotency.execute(scope(key, { amount: "5" }), () =>
      Promise.resolve({ status: 201, body: { ok: false } }),
    );
    expect(same.body).toEqual({ ok: true });
  });

  it("settles a race on one key with exactly one execution", async () => {
    let runs = 0;
    const key = uniq("key");
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        idempotency.execute(scope(key, { n: 1 }), async (tx) => {
          runs += 1;
          // Real work inside the same transaction, so the row and the work commit together.
          await tx.notification.create({
            data: { userId, type: "KYC_APPROVED", title: "t", body: "b" },
          });
          return { status: 201, body: { key } };
        }),
      ),
    );
    expect(runs).toBe(1);
    expect(new Set(results.map((r) => r.body.key)).size).toBe(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(4);
  });

  it("keeps endpoints apart, and forgets a key whose work failed", async () => {
    const key = uniq("key");
    await idempotency.execute(scope(key, {}, "a"), () =>
      Promise.resolve({ status: 200, body: { from: "a" } }),
    );
    const other = await idempotency.execute(scope(key, {}, "b"), () =>
      Promise.resolve({ status: 200, body: { from: "b" } }),
    );
    expect(other.body).toEqual({ from: "b" });

    const failing = uniq("key");
    await expect(
      idempotency.execute(scope(failing, {}), () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(await db.idempotencyKey.count({ where: { userId, key: failing } })).toBe(0);
    const retried = await idempotency.execute(scope(failing, {}), () =>
      Promise.resolve({ status: 200, body: { second: true } }),
    );
    expect(retried.replayed).toBe(false);
  });
});
