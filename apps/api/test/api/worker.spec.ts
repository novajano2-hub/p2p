import { NestFactory } from "@nestjs/core";

import { loadEnv } from "@/config/env";
import { KycRetentionService } from "@/modules/kyc/kyc-retention.service";
import { KycSweepScheduler } from "@/modules/kyc/kyc-sweep.scheduler";
import { WorkerModule } from "@/worker.module";

/*
  The worker process boots, and the job it exists to run is actually wired.

  Nothing else covers this graph. The API tests boot AppModule, which has no
  scheduler in it, so a provider the worker cannot resolve would stay hidden
  until a deployment came up and did nothing. Booting the real module here is
  cheap and says otherwise.
*/
describe("the worker", () => {
  it("boots with the kyc sweep wired, and shuts down cleanly", async () => {
    const context = await NestFactory.createApplicationContext(WorkerModule.forRoot(loadEnv()), {
      logger: false,
    });
    try {
      // Resolving these proves the whole chain: config, Prisma, the object
      // store, Redis for the lock, and the timer that ties them together.
      expect(context.get(KycSweepScheduler)).toBeInstanceOf(KycSweepScheduler);
      expect(context.get(KycRetentionService)).toBeInstanceOf(KycRetentionService);
    } finally {
      // Also the assertion that matters most for a long-running process: the
      // interval is cleared on shutdown, so this test does not leave a handle
      // behind and neither does a SIGTERM in production.
      await context.close();
    }
  });
});
