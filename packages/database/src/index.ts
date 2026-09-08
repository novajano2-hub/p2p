import { PrismaClient } from "@prisma/client";

export { Prisma, PrismaClient } from "@prisma/client";

export type PrismaLogLevel = "query" | "info" | "warn" | "error";

/**
 * The one place a PrismaClient is constructed. The URL is passed in rather
 * than read from the environment here, so the API's validated config is the
 * only source of it and tests can point a client at a scratch database.
 */
export function createPrismaClient(
  datasourceUrl: string,
  log: PrismaLogLevel[] = ["warn", "error"],
) {
  return new PrismaClient({ datasourceUrl, log });
}
