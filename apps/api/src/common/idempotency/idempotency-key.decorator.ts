import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { type FastifyRequest } from "fastify";

import { AppError } from "@/common/errors/app-error";

/*
  The Idempotency-Key header, required on every request that moves money
  (ADR-0007). A client mints it once per intent - one per tap of the button,
  not one per HTTP attempt - and sends the same one on every retry.
*/

export const IDEMPOTENCY_HEADER = "idempotency-key";
const SHAPE = /^[A-Za-z0-9_.:-]{8,200}$/;

export const IdempotencyKey = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  const raw = request.headers[IDEMPOTENCY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !SHAPE.test(value)) {
    throw AppError.validation([
      {
        path: "Idempotency-Key",
        message: "Send an Idempotency-Key header: 8 to 200 characters, letters, digits, _ . : -",
      },
    ]);
  }
  return value;
});
