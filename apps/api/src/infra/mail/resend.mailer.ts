import type { PinoLogger } from "nestjs-pino";

import { MailError, type Mail, type Mailer } from "./mailer";
import { assertNoOpenTransaction } from "@/common/io/transaction-scope";

/*
  Resend, over its HTTP API directly rather than through its SDK. One endpoint
  and one JSON body do not justify a dependency in the supply chain of a
  custodial service, and this way the exact bytes leaving the process are in
  front of whoever reads this file.

  Free tier at the time of writing: 3,000 emails a month, 100 a day, sending
  only from a verified domain (or from onboarding@resend.dev to the account
  owner's own address while there is none). https://resend.com/docs
*/

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ResendMailer.name);
  }

  async send(mail: Mail): Promise<void> {
    assertNoOpenTransaction("sending email");
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new MailError("resend", null, error instanceof Error ? error.message : "unreachable");
    }

    if (!response.ok) {
      // Resend's error body names the problem (unverified domain, bad key,
      // daily quota). Logged, because the person who can fix it reads logs;
      // never sent to the client, who cannot.
      const detail = await response.text().catch(() => "");
      this.logger.error(
        { event: "mail.rejected", provider: "resend", status: response.status, detail },
        "email provider rejected the message",
      );
      throw new MailError("resend", response.status, detail.slice(0, 300));
    }

    this.logger.info({ event: "mail.sent", provider: "resend" }, "email accepted by provider");
  }
}
