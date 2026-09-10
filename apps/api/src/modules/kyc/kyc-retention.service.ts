import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { PrismaService } from "@/infra/prisma/prisma.service";
import { OBJECT_STORE, type ObjectStore } from "@/infra/storage/object-store";

/*
  Throws away photographs nobody submitted.

  Uploading as the photos are taken is what makes a retake cheap and a lost
  connection survivable, but it means someone who photographs their ID and
  then walks away leaves identity documents behind. Those are RESTRICTED data
  (docs/architecture/data-classification.md), and holding them for a person
  who never asked to be verified is not something to defend. So the staging
  area has a deadline: a photograph that no submission has claimed within a
  day is deleted, bytes first, then the row.

  Bytes first, deliberately. Deleting the row first and then failing on the
  object leaves a file nothing points at, which is exactly the state this
  exists to prevent; deleting the object first and then failing on the row
  leaves a row whose bytes are gone, which the next sweep finds and finishes.
  One order self-heals and the other quietly accumulates.
*/

/** How long an unclaimed photograph may sit in the staging area. */
export const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

/** Bounded so one run cannot hold the database or the store for long. Backlog waits for the next. */
const BATCH = 500;

@Injectable()
export class KycRetentionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(KycRetentionService.name);
  }

  /** Deletes staged photographs older than the cutoff. Resolves with how many went. */
  async sweepAbandoned(maxAgeMs: number = ABANDONED_AFTER_MS): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const stale = await this.prisma.client.kycDocument.findMany({
      where: { submissionId: null, createdAt: { lt: cutoff } },
      select: { id: true, storageKey: true },
      orderBy: { createdAt: "asc" },
      take: BATCH,
    });
    if (stale.length === 0) return 0;

    const removable: string[] = [];
    for (const document of stale) {
      try {
        await this.store.delete(document.storageKey);
        removable.push(document.id);
      } catch (error) {
        // The row stays, so the next run tries this one again.
        this.logger.warn(
          { event: "kyc.sweep_delete_failed", key: document.storageKey, err: error },
          "an abandoned photograph could not be removed from the store",
        );
      }
    }

    if (removable.length > 0) {
      await this.prisma.client.kycDocument.deleteMany({ where: { id: { in: removable } } });
      // A count, never whose. Enough to see the sweep working, nothing about anyone.
      this.logger.info(
        {
          event: "kyc.documents_swept",
          removed: removable.length,
          olderThan: cutoff.toISOString(),
        },
        "abandoned photographs removed",
      );
    }
    return removable.length;
  }
}
