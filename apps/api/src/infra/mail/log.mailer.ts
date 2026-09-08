import type { PinoLogger } from "nestjs-pino";

import { type Mail, type Mailer } from "./mailer";

/*
  The mailer for development and tests: writes the message to the log instead
  of sending it. The verification code is in the text, which is the point -
  the flow can be walked end to end with no provider account. Refused in
  production by the environment schema, so this can never be what a customer
  gets.
*/
export class LogMailer implements Mailer {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(LogMailer.name);
  }

  send(mail: Mail): Promise<void> {
    this.logger.info(
      { event: "mail.logged", to: mail.to, subject: mail.subject, text: mail.text },
      "email not sent: no RESEND_API_KEY, message written to the log instead",
    );
    return Promise.resolve();
  }
}
