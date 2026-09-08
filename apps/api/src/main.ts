import "reflect-metadata";

import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import { Logger } from "nestjs-pino";

import { createApp } from "@/app";
import { EnvError, loadEnv } from "@/config/env";

/*
  HTTP entrypoint.

  Order matters: environment first (fail closed before anything opens a
  socket), then the app, then listen, then signal handlers. On SIGTERM the
  server stops accepting connections, drains in-flight requests for up to
  SHUTDOWN_TIMEOUT_MS, and exits; if draining overruns, it exits non-zero
  rather than hang a deploy.
*/

// .env is a local convenience. Production gets its environment from the platform.
if (process.env.NODE_ENV !== "production") {
  loadDotenv({
    path: [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")],
    quiet: true,
  });
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await createApp(env);
  const logger = app.get(Logger);

  await app.listen(env.PORT, env.HOST);
  logger.log(`api listening on http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`);

  const shutdown = (signal: NodeJS.Signals) => {
    logger.log(`${signal} received, draining for up to ${env.SHUTDOWN_TIMEOUT_MS}ms`);
    const deadline = setTimeout(() => {
      logger.error("shutdown deadline passed, exiting");
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    deadline.unref();

    void app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, "shutdown failed");
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

bootstrap().catch((error: unknown) => {
  // The logger may not exist yet. EnvError carries names and rules only, never values.
  console.error(error instanceof EnvError ? error.message : error);
  process.exit(1);
});
