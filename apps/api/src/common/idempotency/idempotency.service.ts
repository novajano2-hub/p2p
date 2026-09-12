import { createHash } from "node:crypto";

import { Prisma } from "@abay/database";
import { Injectable } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";

import { AppError } from "@/common/errors/app-error";
import { PrismaService } from "@/infra/prisma/prisma.service";

/*
  Inbound idempotency (ADR-0007): the same request twice does its work once.

  The key is claimed by inserting its row in the same transaction as the
  work, and the response is stored on that row before the transaction
  commits. That single decision gives every property for free:

    a retry after success      finds the row, gets the stored response
    a retry after a crash      finds nothing (the row rolled back), does the work
    two requests at once       the second's insert waits on the unique index
                               until the first commits, then finds its row
    the same key, new body     found row, different hash: a 409, never a
                               silent overwrite and never a second execution

  What the work does is the caller's; what it may not do is reach the
  network, since it runs inside a transaction (AT-19).
*/

export interface IdempotencyScope {
  userId: string;
  /** Names the operation, so one key cannot replay a different endpoint's response. */
  endpoint: string;
  key: string;
  requestHash: string;
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

export class IdempotencyConflictError extends AppError {
  constructor() {
    super(
      "CONFLICT",
      409,
      "This Idempotency-Key was already used for a different request. Use a new key.",
    );
  }
}

/** Sorted keys, bigint as text: the same request always hashes the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (typeof inner === "bigint") return inner.toString();
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return Object.fromEntries(
        Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    }
    return inner;
  });
}

export const requestHash = (body: unknown): string =>
  createHash("sha256").update(canonicalJson(body)).digest("hex");

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute<T extends Prisma.InputJsonValue>(
    scope: IdempotencyScope,
    work: (tx: Prisma.TransactionClient) => Promise<{ status: number; body: T }>,
  ): Promise<IdempotentResult<T>> {
    const earlier = await this.find(scope);
    if (earlier) return this.replay(earlier, scope);

    try {
      return await this.prisma.transaction(`idempotency:${scope.endpoint}`, async (tx) => {
        // The claim, before the work: this is the statement a concurrent
        // duplicate blocks on. The response is filled in below, same transaction.
        await tx.$executeRaw`
          INSERT INTO idempotency_keys
            (id, user_id, endpoint, key, request_hash, response_status, response_body, "createdAt")
          VALUES (${uuidv7()}, ${scope.userId}, ${scope.endpoint}, ${scope.key},
                  ${scope.requestHash}, 0, 'null'::jsonb, now())`;
        const result = await work(tx);
        await tx.idempotencyKey.update({
          where: {
            userId_endpoint_key: { userId: scope.userId, endpoint: scope.endpoint, key: scope.key },
          },
          data: { responseStatus: result.status, responseBody: result.body },
        });
        return { ...result, replayed: false };
      });
    } catch (error) {
      if (isKeyAlreadyClaimed(error)) {
        const winner = await this.find(scope);
        if (winner) return this.replay(winner, scope);
      }
      throw error;
    }
  }

  private find(scope: IdempotencyScope) {
    return this.prisma.client.idempotencyKey.findUnique({
      where: {
        userId_endpoint_key: { userId: scope.userId, endpoint: scope.endpoint, key: scope.key },
      },
    });
  }

  private replay<T>(
    row: { requestHash: string; responseStatus: number; responseBody: Prisma.JsonValue },
    scope: IdempotencyScope,
  ): IdempotentResult<T> {
    if (row.requestHash !== scope.requestHash) throw new IdempotencyConflictError();
    return { status: row.responseStatus, body: row.responseBody as T, replayed: true };
  }
}

function isKeyAlreadyClaimed(error: unknown): boolean {
  // The raw INSERT surfaces the unique violation as a raw query failure (23505).
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return (
      error.code === "P2002" ||
      (error.code === "P2010" &&
        `${error.message}${JSON.stringify(error.meta ?? {})}`.includes("23505"))
    );
  }
  return false;
}
