import { Module } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { ENV } from "@/config/config.module";
import { type Env } from "@/config/env";

import { LogMailer } from "./log.mailer";
import { MAILER, type Mailer } from "./mailer";
import { ResendMailer } from "./resend.mailer";

/*
  Chooses the mailer from configuration, once, at boot. With an API key the
  real provider is used in every environment; without one, only outside
  production, messages go to the log.
*/
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [ENV, PinoLogger],
      useFactory: (env: Env, logger: PinoLogger): Mailer =>
        env.RESEND_API_KEY
          ? new ResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM, logger)
          : new LogMailer(logger),
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
