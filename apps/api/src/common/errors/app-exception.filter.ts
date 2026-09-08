import { Catch, Injectable, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { type FastifyReply, type FastifyRequest } from "fastify";
import { PinoLogger } from "nestjs-pino";

import { toErrorResponse } from "./error-response";

/*
  The single exception filter. Everything a handler throws (and everything
  Fastify raises before a handler, which Nest routes here too) becomes the
  error envelope from @abay/contracts, tagged with the request's correlation
  id. Unexpected errors are logged with their stack; expected ones are not
  noise-logged at all beyond debug.
*/
@Catch()
@Injectable()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AppExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const correlationId = request.id;

    const { status, body, unexpected } = toErrorResponse(exception, correlationId);

    if (unexpected) {
      this.logger.error({ err: exception, correlationId }, "unhandled error");
    } else {
      this.logger.debug({ correlationId, code: body.error.code, status }, "request rejected");
    }

    void reply.status(status).send(body);
  }
}
