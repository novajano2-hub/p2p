import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import type { PinoLogger } from "nestjs-pino";

import { StorageError, type ObjectStore, type StoredObject } from "./object-store";

/*
  The store for development and tests: a directory on disk, one file per key.
  The flow can be walked end to end with no account anywhere, and a reviewer
  can open the files with whatever opens images. Refused in production by the
  environment schema: a container's disk is not storage.
*/
export class LocalObjectStore implements ObjectStore {
  private readonly root: string;

  constructor(
    directory: string,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LocalObjectStore.name);
    this.root = resolve(directory);
  }

  async put(object: StoredObject): Promise<void> {
    const path = this.pathFor(object.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, object.body);
    this.logger.info(
      { event: "storage.put", provider: "local", key: object.key, bytes: object.body.length, path },
      "object written to disk: no object store is configured",
    );
  }

  async get(key: string): Promise<Buffer | null> {
    const path = this.pathFor(key);
    try {
      return await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new StorageError("local", error instanceof Error ? error.message : "unreadable");
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    const path = resolve(this.root, key);
    // Keys are minted by this API and never taken from a client, but a store
    // that could be pointed outside its own directory is one bug away from
    // being a problem, so the check is here regardless.
    if (!path.startsWith(this.root + sep)) {
      throw new StorageError("local", "key escapes the storage directory");
    }
    return path;
  }
}
