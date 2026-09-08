import { Global, Module, type DynamicModule } from "@nestjs/common";

import { type Env } from "./env";

/** Injection token for the validated environment. */
export const ENV = Symbol("ENV");

/*
  The validated Env is a value, not a service: it is parsed once in the
  entrypoint, before Nest exists, and handed to the module tree. Nothing in
  the application reads process.env directly.
*/
@Global()
@Module({})
export class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
