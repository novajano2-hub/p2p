import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";

import { AppError } from "./app-error";
import { INTERNAL_ERROR_MESSAGE, UNAVAILABLE_MESSAGE, toErrorResponse } from "./error-response";

const id = "req-0123456789";

describe("toErrorResponse", () => {
  it("passes an AppError through with its code, status, message and details", () => {
    const error = AppError.validation([{ path: "amount", message: "must be positive" }]);
    const result = toErrorResponse(error, id);
    expect(result).toEqual({
      status: 400,
      unexpected: false,
      body: {
        error: {
          code: "VALIDATION_FAILED",
          message: "The request is not valid.",
          correlationId: id,
          details: [{ path: "amount", message: "must be positive" }],
        },
      },
    });
  });

  it("turns a ZodError into field-level details without echoing input", () => {
    const parsed = z.object({ email: z.email(), age: z.number().min(18) }).safeParse({
      email: "not-an-email-hunter2",
      age: 3,
    });
    if (parsed.success) throw new Error("expected failure");
    const result = toErrorResponse(parsed.error, id);
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_FAILED");
    expect(result.body.error.details?.map((d) => d.path)).toEqual(["email", "age"]);
    expect(JSON.stringify(result.body)).not.toContain("hunter2");
  });

  it("maps Nest HTTP exceptions to stable codes and keeps 4xx messages", () => {
    expect(toErrorResponse(new NotFoundException("Cannot GET /nope"), id)).toMatchObject({
      status: 404,
      unexpected: false,
      body: { error: { code: "NOT_FOUND", message: "Cannot GET /nope", correlationId: id } },
    });
    expect(
      toErrorResponse(new BadRequestException(["a is required", "b is required"]), id),
    ).toMatchObject({
      status: 400,
      body: { error: { code: "VALIDATION_FAILED", message: "a is required; b is required" } },
    });
  });

  it("never leaks a 5xx message, whatever the source", () => {
    const fromNest = toErrorResponse(new InternalServerErrorException("db password is x"), id);
    const fromAnywhere = toErrorResponse(new Error("ECONNREFUSED 10.0.0.5:5432 as postgres"), id);
    const fromNothing = toErrorResponse("a string someone threw", id);

    for (const result of [fromNest, fromAnywhere, fromNothing]) {
      expect(result.status).toBe(500);
      expect(result.unexpected).toBe(true);
      expect(result.body.error.code).toBe("INTERNAL");
      expect(result.body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
      expect(result.body.error.correlationId).toBe(id);
    }
    expect(JSON.stringify(fromAnywhere.body)).not.toContain("10.0.0.5");
  });

  it("answers 503, not 500, when a dependency is unreachable", () => {
    // What ioredis throws with enableOfflineQueue disabled and no connection.
    const redisDown = new Error("Stream isn't writeable and enableOfflineQueue options is false");
    // What Prisma throws when the database server is not there.
    const databaseDown = Object.assign(new Error("Can't reach database server at localhost:5433"), {
      name: "PrismaClientInitializationError",
      errorCode: "P1001",
    });
    const socketRefused = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });

    for (const error of [redisDown, databaseDown, socketRefused]) {
      const result = toErrorResponse(error, id);
      expect(result.status).toBe(503);
      expect(result.body.error.code).toBe("NOT_READY");
      expect(result.body.error.message).toBe(UNAVAILABLE_MESSAGE);
      // An outage is not a handler bug, but it still belongs in the log with
      // its stack: something operational has to be fixed.
      expect(result.unexpected).toBe(true);
    }

    // And it still says nothing about where the dependency lives.
    expect(JSON.stringify(toErrorResponse(databaseDown, id).body)).not.toContain("5433");
  });

  it("recognises errors Fastify raises before a handler runs", () => {
    const tooLarge = Object.assign(new Error("Request body is too large"), {
      statusCode: 413,
      code: "FST_ERR_CTP_BODY_TOO_LARGE",
    });
    expect(toErrorResponse(tooLarge, id)).toMatchObject({
      status: 413,
      body: { error: { code: "PAYLOAD_TOO_LARGE" } },
    });
  });
});
