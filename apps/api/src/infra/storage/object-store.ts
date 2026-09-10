/*
  The one way the API keeps a file. Identity documents are the first use:
  photographs of a person's ID that must be held somewhere private, written
  once, and read back only by their owner or an administrator.

  Behind an interface so the provider is a configuration choice. Any store
  that speaks the S3 API works (Cloudflare R2 is the recommendation; see
  .env.example for why and how); outside production, with nothing configured,
  files go to a directory on disk so the flow can be walked end to end without
  an account anywhere.
*/

/** Injection token for the configured ObjectStore. */
export const OBJECT_STORE = Symbol("OBJECT_STORE");

export interface StoredObject {
  /** A path-like key such as "kyc/<user id>/<document id>.jpg". Never a URL. */
  key: string;
  body: Buffer;
  contentType: string;
}

export interface ObjectStore {
  /** Resolves once the store has accepted the bytes. Throws StorageError otherwise. */
  put(object: StoredObject): Promise<void>;
  /**
   * The bytes behind a key, or null if the store does not have it. A missing
   * object is an answer, not a fault: a sweep may have removed it between the
   * row being read and the bytes being asked for.
   */
  get(key: string): Promise<Buffer | null>;
  /** Removes an object. Deleting something already gone is not an error. */
  delete(key: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(
    readonly provider: string,
    detail: string,
  ) {
    super(`${provider} could not complete the operation: ${detail}`);
    this.name = "StorageError";
  }
}
