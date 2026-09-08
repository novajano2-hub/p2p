import { z } from "zod";

/** Liveness: the process is up and can answer HTTP. Nothing else is claimed. */
export const healthResponse = z.object({
  status: z.literal("ok"),
});
export type HealthResponse = z.infer<typeof healthResponse>;

export const dependencyStatus = z.enum(["ok", "failed"]);
export type DependencyStatus = z.infer<typeof dependencyStatus>;

/**
 * Readiness: the process can do useful work. Each dependency reports ok or
 * failed and nothing more: no hostnames, no error text, no versions. A load
 * balancer needs the verdict; an attacker probing the endpoint gets nothing.
 */
export const readinessResponse = z.object({
  status: z.enum(["ready", "degraded"]),
  checks: z.object({
    database: dependencyStatus,
    redis: dependencyStatus,
  }),
});
export type ReadinessResponse = z.infer<typeof readinessResponse>;
