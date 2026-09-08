import { type PipeTransform } from "@nestjs/common";
import { type z } from "zod";

import { AppError } from "@/common/errors/app-error";

/*
  Validation at the boundary, with the schema named at the handler:

    @Post()
    create(@Body(zodBody(createOfferRequest)) body: CreateOfferRequest) { ... }

  Handlers receive the parsed, typed output. Nothing past this pipe touches a
  raw request body. Failures become VALIDATION_FAILED with a path and message
  per issue, and never include the offending value.
*/
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw AppError.validation(
        result.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}

export function zodBody<TSchema extends z.ZodType>(schema: TSchema) {
  return new ZodValidationPipe(schema);
}
