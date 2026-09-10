import { Module } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";

import { LocalObjectStore } from "./local.store";
import { OBJECT_STORE, type ObjectStore } from "./object-store";
import { S3ObjectStore } from "./s3.store";

/*
  Chooses the object store from configuration, once, at boot. With storage
  credentials the real store is used in every environment; without them, only
  outside production, files go to a directory on disk. The environment schema
  is what guarantees "only outside production".
*/
@Module({
  providers: [
    {
      provide: OBJECT_STORE,
      inject: [ENV, PinoLogger],
      useFactory: (env: Env, logger: PinoLogger): ObjectStore =>
        env.STORAGE_ENDPOINT &&
        env.STORAGE_BUCKET &&
        env.STORAGE_ACCESS_KEY_ID &&
        env.STORAGE_SECRET_ACCESS_KEY
          ? new S3ObjectStore(
              {
                endpoint: env.STORAGE_ENDPOINT,
                region: env.STORAGE_REGION,
                bucket: env.STORAGE_BUCKET,
                accessKeyId: env.STORAGE_ACCESS_KEY_ID,
                secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
              },
              logger,
            )
          : new LocalObjectStore(env.STORAGE_LOCAL_DIR, logger),
    },
  ],
  exports: [OBJECT_STORE],
})
export class StorageModule {}
