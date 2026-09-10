import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { PinoLogger } from "nestjs-pino";

import { StorageError, type ObjectStore, type StoredObject } from "./object-store";

/*
  Any store that speaks the S3 API: Cloudflare R2, Backblaze B2, MinIO, or S3
  itself. The official client rather than hand-rolled request signing, because
  SigV4 is the one place a subtle bug only shows up against the real service,
  and the person who can reproduce it is the owner with the account.

  Two settings make it work everywhere and not just on AWS. Path-style
  addressing puts the bucket in the URL path instead of inventing a host name
  per bucket. And the SDK's newer habit of attaching a CRC32 checksum to every
  upload is switched back to "only when the operation needs one": not every
  compatible store understands the header, and an upload that is refused for a
  checksum nobody asked for is a confusing failure to debug from a log line.
*/

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Long enough for a large photograph on a slow link; short enough to fail before the client does. */
const TIMEOUT_MS = 60_000;

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(
    private readonly settings: S3Settings,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(S3ObjectStore.name);
    this.client = new S3Client({
      region: settings.region,
      endpoint: settings.endpoint,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async put(object: StoredObject): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.settings.bucket,
          Key: object.key,
          Body: object.body,
          ContentType: object.contentType,
          ContentLength: object.body.length,
        }),
        { abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
      );
    } catch (error) {
      // The provider's message names the problem (bad key, missing bucket,
      // wrong endpoint). Logged for whoever can fix it; never sent to a client.
      this.logger.error(
        { event: "storage.put_failed", provider: "s3", key: object.key, err: error },
        "object store rejected the upload",
      );
      throw new StorageError("s3", error instanceof Error ? error.message : "unreachable");
    }
    this.logger.info(
      { event: "storage.put", provider: "s3", key: object.key, bytes: object.body.length },
      "object stored",
    );
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(
        { event: "storage.delete_failed", provider: "s3", key, err: error },
        "object store refused the delete",
      );
      throw new StorageError("s3", error instanceof Error ? error.message : "unreachable");
    }
  }
}
