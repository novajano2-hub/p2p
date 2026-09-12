import "reflect-metadata";

import { resolve } from "node:path";

import { NestFactory } from "@nestjs/core";
import { config as loadDotenv } from "dotenv";
import { Logger } from "nestjs-pino";

import { EnvError, loadEnv } from "@/config/env";
import { WorkerModule } from "@/worker.module";

if (process.env.NODE_ENV !== "production") {
  loadDotenv({
    path: [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")],
    quiet: true,
  });
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const context = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), {
    bufferLogs: true,
  });
  const logger = context.get(Logger);
  context.useLogger(logger);
  logger.log(
    "worker ready: kyc sweep, outbox publisher, chain observer, deposit confirmer and withdrawal processor running",
  );

  const shutdown = (signal: NodeJS.Signals) => {
    logger.log(`${signal} received, stopping worker`);
    const deadline = setTimeout(() => process.exit(1), env.SHUTDOWN_TIMEOUT_MS);
    deadline.unref();
    void context.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof EnvError ? error.message : error);
  process.exit(1);
});
