import { type HealthResponse, type ReadinessResponse } from "@abay/contracts";
import { Controller, Get, Res } from "@nestjs/common";
import { type FastifyReply } from "fastify";

import { ReadinessService } from "./readiness.service";

/*
  Liveness and readiness are different questions and get different answers.

    /health  "is the process alive?"          always 200 while the server runs
    /ready   "can it do useful work?"         200 when every dependency answers,
                                              503 with per-dependency verdicts if not

  Both are unversioned (a load balancer's contract, not the API's) and both
  say nothing an attacker could use: no versions, hostnames or error text.
*/
@Controller()
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get("health")
  health(): HealthResponse {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessResponse> {
    const [database, redis] = await Promise.all([
      this.readiness.database(),
      this.readiness.redis(),
    ]);
    const ready = database === "ok" && redis === "ok";
    void reply.status(ready ? 200 : 503);
    return { status: ready ? "ready" : "degraded", checks: { database, redis } };
  }
}
