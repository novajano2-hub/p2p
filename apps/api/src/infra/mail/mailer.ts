/*
  The one way the API sends email. Behind an interface so the provider is a
  configuration choice: Resend today because its free tier covers a launch and
  its API is a single HTTP call, something else tomorrow without touching the
  auth module.
*/

/** Injection token for the configured Mailer. */
export const MAILER = Symbol("MAILER");

export interface Mail {
  to: string;
  subject: string;
  /** Plain text is the version that always renders; HTML is the nicer one. */
  text: string;
  html: string;
}

export interface Mailer {
  /** Resolves once the provider has accepted the message. Throws MailError otherwise. */
  send(mail: Mail): Promise<void>;
}

export class MailError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number | null,
    detail: string,
  ) {
    super(`${provider} rejected the message${status ? ` (${status})` : ""}: ${detail}`);
    this.name = "MailError";
  }
}
